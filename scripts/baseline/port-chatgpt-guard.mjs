/**
 * 把补丁版 chatgpt-web.mjs 里的「composer 自愈 + 附件校验」三个能力搬到出厂 0.3.4 版本上。
 * 不整文件替换：0.3.4 自己的 DOM 适配（MarkdownRoot 等）要保留。
 *
 * 用法：node scripts/baseline/port-chatgpt-guard.mjs [--dry]
 */
import { readFileSync, writeFileSync } from "node:fs";

const PATCHED = "W:/dsh/pw-analyze/build-src/electron/chatgpt-web.mjs";
const TARGET = "W:/dsh/pw-repo/electron/chatgpt-web.mjs";
const dry = process.argv.includes("--dry");

const patchedLines = readFileSync(PATCHED, "utf8").split(/\r?\n/);
let target = readFileSync(TARGET, "utf8");

const METHOD_RE = /^ {2}(?:async\s+)?#\w+\s*\(/;

/** 从方法名找到它的完整块（到下一个同级方法之前）。 */
function extractBlock(lines, name) {
  const start = lines.findIndex(
    (line) => METHOD_RE.test(line) && line.includes(`#${name}(`),
  );
  if (start < 0) throw new Error(`补丁版里找不到 #${name}`);
  let end = start + 1;
  while (end < lines.length && !METHOD_RE.test(lines[end])) end += 1;
  // 去掉尾部空行，保留方法自身的收尾大括号
  while (end > start + 1 && lines[end - 1].trim() === "") end -= 1;
  return lines.slice(start, end).join("\n");
}

const NEW_METHODS = [
  "composerAttachments",
  "composerHealth",
  "reloadPage",
  "ensureComposerHealthy",
  "assertComposerAttachments",
  "assertSentAttachments",
];
const blocks = NEW_METHODS.map((name) => extractBlock(patchedLines, name));

for (const name of NEW_METHODS) {
  if (target.includes(`#${name}(`))
    throw new Error(`目标文件已存在 #${name}，请先回滚`);
}

const anchor = "  async #send(win) {";
if (!target.includes(anchor)) throw new Error("目标文件找不到 #send 锚点");
target = target.replace(anchor, `${blocks.join("\n\n")}\n\n${anchor}`);

const edits = [
  [
    "    await this.#waitForTurnReady(win)\n\n    const tempDir",
    "    await this.#waitForTurnReady(win)\n    // 模型列表没加载出来时 composer 的发送按钮会永久禁用，先自愈再继续。\n    await this.#ensureComposerHealthy(win)\n\n    const tempDir",
  ],
  [
    "      if (files.length > 0) await this.#uploadFiles(win, files)\n",
    "      if (files.length > 0) await this.#uploadFiles(win, files)\n      if (files.length > 0) await this.#assertComposerAttachments(win, files.length)\n",
  ],
  [
    "      await this.#send(win)\n",
    "      await this.#send(win)\n      if (files.length > 0) await this.#assertSentAttachments(win)\n",
  ],
];

for (const [from, to] of edits) {
  const hits = target.split(from).length - 1;
  if (hits !== 1)
    throw new Error(
      `锚点命中 ${hits} 次（应为 1）：${from.trim().slice(0, 40)}`,
    );
  target = target.replace(from, to);
}

console.log(`新增方法 ${NEW_METHODS.length} 个，调用点 ${edits.length} 处`);
console.log(
  `目标文件 ${readFileSync(TARGET, "utf8").split(/\r?\n/).length} 行 → ${target.split(/\r?\n/).length} 行`,
);
if (!dry) {
  writeFileSync(TARGET, target, "utf8");
  console.log("已写入");
} else {
  console.log("（dry run，未写入）");
}
