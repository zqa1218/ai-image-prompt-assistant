/**
 * 多选字段在 intake 里仍以字符串存储，用英文逗号分隔。
 * 约束：选项文案本身不能包含英文逗号——当前所有选项都满足。
 */
const SEPARATOR = ','

export function parseMulti(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(SEPARATOR)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function toggleMulti(value: string | undefined, option: string): string {
  const list = parseMulti(value)
  const next = list.includes(option)
    ? list.filter((item) => item !== option)
    : [...list, option]
  return next.join(SEPARATOR)
}

export function formatMulti(value: string | undefined): string {
  return parseMulti(value).join('、')
}
