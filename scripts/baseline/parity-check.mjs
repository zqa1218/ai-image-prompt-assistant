/**
 * 前端等价性核查 v2
 * 只用「不含模板插值的中文字面量」作探针 —— 压缩不会改它，tree-shake 才可能删。
 * 排除测试文件与纯函数名探针，避免噪声。
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SRC = "W:/dsh/pw-repo/src";
const BUNDLE_DIR = "W:/dsh/pw-analyze/app-pristine/dist/assets";

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name))
      out.push(full);
  }
  return out;
}

function probesOf(text, limit = 4) {
  const found = [];
  for (const match of text.matchAll(/[`'"]([^`'"\n$]{6,48})[`'"]/gu)) {
    const value = match[1].trim();
    if (!/[\u4e00-\u9fa5]/.test(value)) continue;
    if (/[{}<>]/.test(value)) continue;
    if (found.includes(value)) continue;
    found.push(value);
    if (found.length >= limit) break;
  }
  return found;
}

const bundleFile = readdirSync(BUNDLE_DIR).find((f) =>
  /^index-.*\.js$/.test(f),
);
const bundle = readFileSync(path.join(BUNDLE_DIR, bundleFile), "utf8");

const rows = [];
for (const file of walk(SRC)) {
  const rel = path.relative("W:/dsh/pw-repo", file).replace(/\\/g, "/");
  const probes = probesOf(readFileSync(file, "utf8"));
  if (!probes.length) {
    rows.push({ rel, probes, result: "无可用探针", missing: [] });
    continue;
  }
  const missing = probes.filter((p) => !bundle.includes(p));
  const result =
    missing.length === 0
      ? "命中"
      : missing.length === probes.length
        ? "未命中"
        : "部分命中";
  rows.push({ rel, probes, result, missing });
}

const count = (name) => rows.filter((r) => r.result === name).length;
const lines = [];
lines.push("# 前端等价性核查（基线 P0）");
lines.push("");
lines.push(
  `- 出厂 bundle：\`${bundleFile}\`（${Math.round(bundle.length / 1024)} KB）`,
);
lines.push(`- 源码模块：${rows.length} 个（已排除 \`*.test.*\`）`);
lines.push(
  `- 探针规则：不含模板插值的中文字面量，压缩不改名、只可能被 tree-shake`,
);
lines.push("");
lines.push(`| 结论 | 模块数 |`);
lines.push(`| --- | --- |`);
lines.push(`| 命中（出厂包含该模块字符串） | ${count("命中")} |`);
lines.push(`| 部分命中 | ${count("部分命中")} |`);
lines.push(`| 未命中 | ${count("未命中")} |`);
lines.push(`| 无可用探针 | ${count("无可用探针")} |`);
lines.push("");
lines.push("## 未命中（重点排查）");
lines.push("");
const missed = rows.filter((r) => r.result === "未命中");
if (!missed.length) lines.push("无。");
for (const row of missed) {
  lines.push(`- \`${row.rel}\` —— 探针：${row.probes.join(" / ")}`);
}
lines.push("");
lines.push("## 部分命中");
lines.push("");
const partial = rows.filter((r) => r.result === "部分命中");
if (!partial.length) lines.push("无。");
for (const row of partial) {
  lines.push(`- \`${row.rel}\` —— 缺：${row.missing.join(" / ")}`);
}
lines.push("");
lines.push("## 命中（源码与出厂一致）");
lines.push("");
for (const row of rows.filter((r) => r.result === "命中"))
  lines.push(`- \`${row.rel}\``);

const out = "W:/dsh/pw-repo/docs/baseline-parity.md";
writeFileSync(out, `${lines.join("\n")}\n`, "utf8");
console.log(`已写入 ${out}`);
console.log(
  `命中 ${count("命中")} / 部分 ${count("部分命中")} / 未命中 ${count("未命中")} / 无探针 ${count("无可用探针")}（共 ${rows.length}）`,
);
console.log("\n未命中明细：");
for (const row of missed)
  console.log(`- ${row.rel}  探针: ${row.probes.join(" | ").slice(0, 100)}`);
