/** 显式手动运行；只提交 1px 测试图，不读取用户工作图片。会使用网页/API 额度。 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const base = "http://127.0.0.1:8787";
async function call(endpoint, method = "GET", body) {
  const response = await fetch(base + endpoint, {
    method,
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(240000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error?.message || `HTTP ${response.status}`);
  return result;
}
const settings = await call("/api/settings");
const dataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const id = `test-${createHash("sha256").update(dataUrl).digest("hex")}`;
const request = {
  conversationId: id,
  thinking: { type: "disabled" },
  max_tokens: 100,
  messages: [
    {
      role: "system",
      content:
        "这是软件连接测试。不要生成图片，不要解释，只按本轮要求返回测试口令。",
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "只回复 XIUTU_THREAD_OK。\n## 图片附件：REFERENCE_0（底图 / 原图）",
        },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    },
  ],
};
try {
  if (process.argv.includes("--web")) {
    await call("/api/settings", "PUT", { mode: "gemini-web" });
    const first = await call("/api/chat", "POST", request);
    assert.match(first.choices[0].message.content, /XIUTU_THREAD_OK/);
    const mappingPath = path.join(
      process.env.APPDATA,
      "AI修图提示词助手",
      "gemini-conversations.json",
    );
    const before = JSON.parse(await readFile(mappingPath, "utf8"))[id];
    const second = await call("/api/chat", "POST", request);
    assert.match(second.choices[0].message.content, /XIUTU_THREAD_OK/);
    const after = JSON.parse(await readFile(mappingPath, "utf8"))[id];
    assert.equal(before.url, after.url);
    assert.equal(after.dirty, false);
    assert.equal(Object.keys(after.images).length, 1);
    console.log("PASS Gemini: 两轮相同回复成功抓取，复用同一对话和附件");
  }
  if (process.argv.includes("--api")) {
    assert.equal(settings.hasKey, true, "尚无 API Key");
    await call("/api/settings", "PUT", { mode: "api" });
    const rules = await Promise.all(
      ["wenjun-cos-retouch", "figure-base-rules"].map((name) =>
        readFile(`src/workflows/assets/${name}.md`, "utf8"),
      ),
    );
    const result = await call("/api/chat", "POST", {
      ...request,
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content:
            rules.join("\n\n") +
            "\n当前仅进行连接测试：不要生成修图提示词，请遵从下面测试任务。",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "连接测试：请只回复 XIUTU_API_OK，不需要描述这张 1 像素测试图。",
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    });
    assert.match(result.choices[0].message.content, /XIUTU_API_OK/);
    console.log("PASS API: 当前配置模型接收两份 Skill 与测试图片并返回回复");
  }
} finally {
  await call("/api/settings", "PUT", { mode: settings.mode });
}
