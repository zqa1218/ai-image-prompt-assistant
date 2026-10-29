import { z } from "zod";
import refineRaw from "./refine.workflow.json";
import recomposeRaw from "./recompose.workflow.json";
import type { Workflow } from "./types.ts";

const thinkingSchema = z.union([
  z.object({ mode: z.literal("disabled") }),
  z.object({
    mode: z.literal("enabled"),
    effort: z.enum(["low", "high", "max"]),
  }),
]);

const fieldSchema = z.object({
  group: z.enum(['constraint', 'requirement', 'format']).optional(),
  key: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["text", "textarea", "select", "multi"]),
  required: z.boolean(),
  placeholder: z.string().optional(),
  options: z.array(z.string()).optional(),
  defaultValue: z.string().optional(),
  showWhen: z
    .object({ field: z.string().min(1), includes: z.string().min(1) })
    .optional(),
});

const directiveSchema = z.object({
  when: z.object({ field: z.string().min(1), includes: z.string().min(1) }),
  instruction: z.string().min(1),
  label: z.string().min(1),
});

const stageSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  intent: z.string().min(1),
  mode: z.enum(["form", "auto", "choice", "hybrid", "free"]),
  thinking: thinkingSchema,
  fields: z.array(fieldSchema).optional(),
  minOptions: z.number().int().positive().optional(),
  maxOptions: z.number().int().positive().optional(),
  outputContract: z
    .enum(["complete-cn", "four-section-cn", "mj-prompt-en"])
    .optional(),
});

const workflowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  summary: z.string().min(1),
  outputContract: z.enum(["complete-cn", "four-section-cn", "mj-prompt-en"]),
  sharedAssets: z.array(z.string().min(1)),
  assets: z.array(z.string().min(1)),
  directives: z.array(directiveSchema).optional(),
  stages: z.array(stageSchema).min(1),
});

function parseWorkflow(raw: unknown, label: string): Workflow {
  const result = workflowSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`${label} 定义不合法：${result.error.message}`);
  }
  return result.data as Workflow;
}

export const REFINE = parseWorkflow(refineRaw, "refine.workflow.json");
export const RECOMPOSE = parseWorkflow(recomposeRaw, "recompose.workflow.json");

/**
 * 分步生成线：与原图精修线共用阶段与资产，只在两处不同。
 * 1) 反向拆解多一条约束——每个新增物体必须标注层级（L1~L4）；
 * 2) 生成阶段换成三段契约（见 llm/contracts.ts 的 threeStepContract）：
 *    第 1 步合并背景与景别陈设，第 2 步固定走参考图模式，第 3 步是氛围层。
 */
const REFINE_STEPS_INTENT =
  "按九维事实层拆解原图，并追加风格机制层：把「高级、氛围感」翻译成白平衡、曝光、反差、高光、锐度、噪点、压缩与景深。" +
  "人像走摄影企划拆解，非人像走七层结构拆解。\n\n" +
  "必须把画面里每一个「新增或会改变画面」的物体按四层归类，并在分析结果里逐项标注层级：\n" +
  "L1 背景层 —— 地面、天空、天花板、整幅环境的大范围置换；\n" +
  "L2 景别内陈设 —— 与角色处于同一景别但没有身体接触：弹药箱、坐骑、座椅、屏风、地台、手办台、脚边道具；\n" +
  "L3 身体互动层 —— 紧贴身体并影响局部形体的东西：能量体、粒子、武器光效、水/火/电、束缚身体的绳索；\n" +
  "L4 氛围层 —— 全局叠加物：雨、雾、体积光、前景花瓣与树叶。\n" +
  "同一个物体只归入它主要影响的那一层，其余层用一句「保持前一步结果不变」带过。";

const refineStepsRaw = {
  ...refineRaw,
  id: "refine-steps",
  name: "分步生成线",
  summary:
    "把原图精修拆成三层提示词：背景与景别陈设 → 身体互动特效 → 氛围层，每层一段、可分别复制逐步执行。",
  stages: refineRaw.stages.map((stage) =>
    stage.id === "analyze" ? { ...stage, intent: REFINE_STEPS_INTENT } : stage,
  ),
};

export const REFINE_STEPS = parseWorkflow(
  refineStepsRaw,
  "refine-steps.workflow.json",
);
export const WORKFLOWS: Workflow[] = [REFINE, RECOMPOSE, REFINE_STEPS];

export function getWorkflow(id: string): Workflow {
  const found = WORKFLOWS.find((w) => w.id === id);
  if (!found) throw new Error(`未知工作流：${id}`);
  return found;
}
