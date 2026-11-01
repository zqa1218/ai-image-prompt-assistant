import type { RawArtifact } from "./schemas.ts";

export type MjBlock = { key: string; body: string };

const isPositive = (key: string) => /正面|positive/i.test(key);
const isNegative = (key: string) => /负面|negative/i.test(key);

/**
 * Midjourney 产物拼装。
 *
 * MJ 的比例与参数必须写在同一行提示词末尾，没有独立的「参数栏」，
 * 负向也是 `--no xxx` 追加在同一行，而不是单独一段。
 * 所以这里产出四块：完整一行（可直接粘贴）、正面、负面、参数；
 * 前端的段落渲染会按【标题】自动分块，每块都能单独复制。
 */
export function buildMjBlocks(
  data: RawArtifact,
): { prompt: string; blocks: MjBlock[] } | null {
  const raw = (data.sections ?? [])
    .map((section) => ({ key: section.key.trim(), body: section.body.trim() }))
    .filter((section) => section.key && section.body);
  if (raw.length === 0) return null;

  const positive = (raw.find((section) => isPositive(section.key)) ?? raw[0])
    .body;
  const negative = raw
    .filter((section) => isNegative(section.key))
    .map((section) => section.body)
    .join(", ");
  const params = (data.params ?? [])
    .map((param) => param.trim())
    .filter(Boolean);
  const paramLine = params.join(" ");
  const fullLine = [positive, paramLine, negative ? `--no ${negative}` : ""]
    .filter(Boolean)
    .join(" ")
    .trim();

  const blocks: MjBlock[] = [
    { key: "完整一行（可直接粘贴）", body: fullLine },
    ...raw,
  ];
  if (paramLine) blocks.push({ key: "参数", body: paramLine });

  return {
    prompt: blocks
      .map((block) => `【${block.key}】\n${block.body}`)
      .join("\n\n"),
    blocks,
  };
}
