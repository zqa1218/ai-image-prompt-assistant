import { parseMulti } from './multiValue.ts';
export function appendConstraint(text: string, label: string): string {
  const line = `保持不变：${label}`;
  return text.split('\n').some(item => item.trim() === line) ? text : [text.trim(), line].filter(Boolean).join('\n');
}
export function migratePreserve(input: Record<string, string>): Record<string, string> {
  if (!input.preserve) return input;
  const next = { ...input };
  for (const label of parseMulti(next.preserve)) next.constraints = appendConstraint(next.constraints ?? '', label);
  delete next.preserve;
  return next;
}

/**
 * 旧存档里的交付形式写作「1 条完整中文 Prompt」。
 * 改成中性文案后，旧值对不上任何选项，下拉会显示空白——这里把它迁过来。
 */
export function migrateOutputMode(input: Record<string, string>): Record<string, string> {
  const value = input.outputMode;
  if (!value) return input;
  const fixed = value.replace(/^1 条完整中文 Prompt$/, '1 条完整提示词');
  return fixed === value ? input : { ...input, outputMode: fixed };
}