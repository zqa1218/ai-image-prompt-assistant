import type { IntakeField, WorkflowStage } from '../workflows/types.ts'
import { parseMulti } from './multiValue.ts'

/**
 * 条件字段可见性：声明了 showWhen 的字段，只有在其依赖字段包含指定值时才出现。
 * 用于「勾了置入物体才问放置层次、远近、交互关系」这类场景。
 */
export function visibleFields(
  stage: WorkflowStage,
  intake: Record<string, string>,
): IntakeField[] {
  return (stage.fields ?? []).filter(
    (field) =>
      !field.showWhen ||
      parseMulti(intake[field.showWhen.field]).includes(field.showWhen.includes),
  )
}
