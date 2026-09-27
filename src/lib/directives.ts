import type { Workflow } from '../workflows/types.ts'
import { parseMulti } from './multiValue.ts'

export type ResolvedDirective = {
  label: string
  instruction: string
  /** 触发它的字段与取值，用于界面回显 */
  source: string
}

/**
 * 把接收阶段的取值翻译成请求级指令。
 * 单选字段（如「参考图职责」）同样走 parseMulti——单值解析出来就是单元素数组。
 */
export function resolveDirectives(
  workflow: Workflow,
  intake: Record<string, string>,
): ResolvedDirective[] {
  return (workflow.directives ?? [])
    .filter((directive) =>
      parseMulti(intake[directive.when.field]).includes(directive.when.includes),
    )
    .map((directive) => ({
      label: directive.label,
      instruction: directive.instruction,
      source: `${directive.when.field} → ${directive.when.includes}`,
    }))
}
