/** 本地服务冒烟测试；不会访问 Gemini，也不会提交任何图片。 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PORT = 8788;
const BASE = `http://127.0.0.1:${PORT}`;
const results = [];
let failures = 0;
const bridgeDir = await mkdtemp(path.join(os.tmpdir(), "promptwizard-smoke-"));

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
}

async function json(pathname, init) {
  const response = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  try {
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } catch {
    return { status: response.status, body: text };
  }
}

async function waitForHealth() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return true;
    } catch {
      // 服务还没起来
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

const child = spawn(process.execPath, ["server/index.mjs"], {
  cwd: process.cwd(),
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PW_API_PORT: String(PORT),
    PROMPT_WIZARD_DATA_DIR: bridgeDir,
    DEEPSEEK_API_KEY: "",
    PROMPT_WIZARD_BRIDGE_DIR: bridgeDir,
  },
});
let serverLog = "";
child.stdout.on("data", (data) => {
  serverLog += data.toString();
});
child.stderr.on("data", (data) => {
  serverLog += data.toString();
});

try {
  const up = await waitForHealth();
  check("服务启动 /api/health", up, up ? "" : serverLog.trim());
  if (!up) throw new Error("服务未启动");

  const settings = await json("/api/settings");
  check(
    "设置明确使用 Gemini 网页且不需要 Key",
    settings.status === 200 &&
      settings.body?.mode === "gemini-web" &&
      settings.body?.hasKey === false,
    JSON.stringify(settings.body),
  );

  const models = await json("/api/models");
  check(
    "模型入口包含网页与默认 API 模型",
    models.status === 200 && models.body?.models?.[0]?.id === "gemini-web",
    JSON.stringify(models.body),
  );

  const gemini = await json("/api/gemini/status");
  check(
    "纯服务模式提示需启动桌面端",
    gemini.status === 200 && gemini.body?.connected === false,
    JSON.stringify(gemini.body),
  );

  const chat = await json("/api/chat", {
    method: "POST",
    body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
  });
  check(
    "纯服务模式不会回退到 API",
    chat.status === 503 && /桌面端/.test(chat.body?.error?.message || ""),
    `${chat.status} ${JSON.stringify(chat.body)}`,
  );

  const switched = await json("/api/settings", {
    method: "PUT",
    body: JSON.stringify({ mode: "api" }),
  });
  check(
    "快速切换 API 并保留默认模型",
    switched.body?.mode === "api" && switched.body?.model === "deepseek-flash",
  );
  const noKey = await json("/api/chat", {
    method: "POST",
    body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
  });
  check(
    "无 Key 时给出配置提示，不偷偷调用网页",
    noKey.status === 400 && /API Key/.test(noKey.body?.error?.message || ""),
  );
  const denied = await json("/api/settings", {
    method: "PUT",
    headers: { origin: "https://example.com" },
    body: JSON.stringify({ mode: "api" }),
  });
  check("拒绝外部网页修改本机模型配置", denied.status === 403);
  const restored = await json("/api/settings", {
    method: "PUT",
    body: JSON.stringify({ mode: "gemini-web" }),
  });
  check("快速切回网页", restored.body?.mode === "gemini-web");

  if (existsSync(path.join(process.cwd(), "dist"))) {
    const page = await fetch(`${BASE}/`);
    const html = await page.text();
    check(
      "根路径返回前端页面",
      page.status === 200 && html.includes('id="root"'),
      `${page.status}`,
    );

    const traversal = await fetch(`${BASE}/%2e%2e%2f%2e%2e%2fpackage.json`);
    check(
      "拒绝目录穿越",
      !(await traversal.text()).includes("prompt-wizard"),
      `${traversal.status}`,
    );
  }
} catch (error) {
  check(
    "冒烟测试执行",
    false,
    error instanceof Error ? error.message : String(error),
  );
} finally {
  child.kill();
  await rm(bridgeDir, { recursive: true, force: true });
}

console.log("\n===== 冒烟结果 =====");
for (const result of results) {
  console.log(
    `${result.ok ? "PASS" : "FAIL"}  ${result.name}${result.ok || !result.detail ? "" : `\n        ${result.detail}`}`,
  );
}
console.log(`\n${results.length - failures}/${results.length} 通过`);
process.exit(failures === 0 ? 0 : 1);
