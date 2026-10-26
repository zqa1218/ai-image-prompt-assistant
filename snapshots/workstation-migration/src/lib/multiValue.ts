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

/**
 * 全选 / 取消全选一个多选字段。
 * 只增删本字段的选项，其它字段留下的值不受影响（同一 key 下不会出现重复项）。
 */
export function setMultiAll(
  value: string | undefined,
  options: readonly string[],
  on: boolean,
): string {
  const current = parseMulti(value)
  if (!on) return current.filter((item) => !options.includes(item)).join(SEPARATOR)
  const merged = [...current]
  for (const option of options) {
    if (!merged.includes(option)) merged.push(option)
  }
  return merged.join(SEPARATOR)
}

/** 本字段是否已经全部勾选，用于把「全选」按钮切成「取消全选」。 */
export function isAllSelected(value: string | undefined, options: readonly string[]): boolean {
  if (options.length === 0) return false
  const current = parseMulti(value)
  return options.every((option) => current.includes(option))
}
