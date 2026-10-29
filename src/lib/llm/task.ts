import type { ResolvedDirective } from "../directives.ts";
import { hairTask, HAIR_OUTPUT, usesPaintedHair } from "./hairTask.ts";
import {
  DETAIL_CHECKLIST,
  DETAIL_PERSONA,
  DETAIL_RESEARCH,
  threeStepContract,
} from "./contracts.ts";
import { visibleFields } from "../fields.ts";
import type {
  Artifact,
  DirectionOption,
  ReferenceItem,
  WizardImage,
} from "../wizardTypes.ts";
import type { Workflow, WorkflowStage } from "../../workflows/types.ts";

export type TaskInput = {
  workflow: Workflow;
  stage: WorkflowStage;
  intake: Record<string, string>;
  images: WizardImage[];
  analysis: string;
  options: DirectionOption[];
  selectedOptionId: string | null;
  notes: string[];
  artifact: Artifact | null;
  directives: ResolvedDirective[];
  /** 用户从参考图里勾选要导入的项 */
  selectedReferenceItems?: ReferenceItem[];
  /** 迭代阶段的单点修改要求 */
  focus?: string;
};

const FIELD_LABELS: Record<string, string> = {
  requirement: "需求",
  usage: "用途",
  taskType: "任务类型",
  spec: "输出规格",
  constraints: "约束",
  referenceRole: "参考图职责",
  editRegion: "编辑区域",
  preserve: "保持不变",
  placementMode: "置景模式",
  effectSource: "特效发生源/方向",
  outputMode: "交付形式",
};

/**
 * 每个阶段都要显式声明「只要文字」。
 *
 * 网页端（Gemini 4）在带图消息里读到「置入 / 迁移 / 修图」这类字样时，
 * 容易直接开始生成图片而不是作答；这条约束同时覆盖网页端和 API 端。
 */
const TEXT_ONLY_RULE =
  "只输出文字结果：不要生成、创建或编辑图片，也不要调用图像生成能力；" +
  "随消息附带的图片只作为你阅读的信息。";

/**
 * 网页端常把「建议使用某某模型进行生成」这类建议直接写进 prompt 末尾，
 * 用户复制的是 prompt，于是这句废话会被一起带进绘图工具。
 */
const NO_TRAILING_ADVICE =
  "prompt 字段只放提示词正文本身：不要在结尾追加「建议使用…」「可以配合…」「希望能帮到你」" +
  "这类工具推荐、使用说明或寒暄，也不要另起「说明」「注意」段落；这类信息只写进 channel 字段。";

/**
 * 提示词正文的语言。
 * 强调从最早阶段就生效：分析、方向、细化阶段就可以用该语言思考，
 * 但真正必须遵守的是 prompt 字段——标题 / channel / checklist 仍用中文，
 * 否则前端按【】分段和结果面板都会失效。
 */
function promptLanguageBlock(input: TaskInput): string {
  const choice = (input.intake.promptLanguage ?? "").trim();
  if (!choice.includes("英文")) return "";
  return (
    "## 输出语言\n" +
    "prompt 字段的正文必须用**英文**书写：用词具体、命令句、不夹中文。\n" +
    "以下例外仍用中文：段落标题（如【正面提示词】）、channel 字段、checklist 字段、" +
    "以及给用户看的解释文字。\n" +
    "英文正文里不要出现「参考图1」「REFERENCE_1」这类来源标记——改用物体本身的描述。"
  );
}

/** 提示词正文用什么语言写：契约文案跟着它走，否则「英文」和「中文 Prompt」自相矛盾。 */
function languageWord(input: TaskInput): string {
  return (input.intake.promptLanguage ?? "").includes("英文") ? "英文" : "中文";
}

/** 只把多选值里的逗号换成顿号，便于模型阅读。 */
function humanize(value: string): string {
  return value.replace(/,/g, "、");
}

/**
 * 「原图尺寸」是个相对说法，模型看不到原图的实际像素，必须在这里展开成具体数值。
 */
function expandIntakeValue(
  key: string,
  value: string,
  images: WizardImage[],
): string {
  if (key !== "outputSize") return value;
  const original = images.find((image) => image.role === "original");
  if (!original || !value.includes("原图尺寸")) return value;
  return value.replace(
    "原图尺寸",
    `原图尺寸（${original.width}×${original.height}）`,
  );
}

/**
 * 组装「本次请求」的用户消息。
 *
 * 注意这里的内容全部是**变动部分**：固定资产在 system 里，前缀必须逐字不变。
 */
export function buildStageTask(input: TaskInput): string {
  const { workflow, stage } = input;
  const blocks: string[] = [];

  blocks.push(`## 本次任务\n${stage.intent}`);

  blocks.push(
    `## 工作流\n${workflow.name}：${workflow.summary}\n` +
      `输出契约：${workflow.outputContract === "mj-prompt-en" ? "英文 Midjourney 提示词 + 参数矩阵" : workflow.outputContract === "complete-cn" ? `独立完整的${languageWord(input)}修图 Prompt` : "中文四段式编辑提示词"}`,
  );

  // 表单字段只声明在接收阶段，其它阶段没有 fields。
  // 这里必须回到接收阶段取，否则用户填的需求根本进不了请求。
  const intakeStage = workflow.stages.find((s) => s.id === "intake");
  const filled = visibleFields(intakeStage ?? stage, input.intake)
    .map((field) => {
      const value = (input.intake[field.key] ?? "").trim();
      return value
        ? `- ${FIELD_LABELS[field.key] ?? field.label}：${humanize(expandIntakeValue(field.key, value, input.images))}`
        : null;
    })
    .filter((line): line is string => line !== null);
  if (filled.length > 0) {
    blocks.push(`## 用户需求\n${filled.join("\n")}`);
  }

  if (input.directives.length > 0) {
    const lines = input.directives.map((d) => `- ${d.label}：${d.instruction}`);
    blocks.push(`## 已启用的专项规则（必须遵守）\n${lines.join("\n")}`);
  }

  if (input.selectedReferenceItems && input.selectedReferenceItems.length > 0) {
    const lines = input.selectedReferenceItems.map(
      (item) =>
        `- [${item.category}] ${item.label}（来自${item.source}）：${item.description}`,
    );
    blocks.push(
      `## 要从参考图导入的内容（用户已勾选）\n${lines.join("\n")}\n` +
        `这些是本次唯一允许从参考图迁移的成分。逐项说明它落在原图的什么位置、如何与原图的光向、透视与景深对齐；未勾选的内容不要引入。`,
    );
  }

  if (input.images.length > 0) {
    let referenceIndex = 0;
    const lines = input.images.map((image) => {
      if (image.role === "original") {
        return `- 原图（统一称为 REFERENCE_0）：${image.name}`;
      }
      referenceIndex += 1;
      const duty = image.note?.trim();
      return `- 参考图${referenceIndex}：${image.name}${duty ? `｜分工：${duty}` : ""}`;
    });
    const hasReference = input.images.some(
      (image) => image.role === "reference",
    );
    blocks.push(
      `## 图片\n本请求附带 ${input.images.length} 张图，职责固定如下：\n${lines.join("\n")}\n` +
        `原图统一称为 REFERENCE_0${hasReference ? "；参考图按「参考图1」「参考图2」的编号引用，编号不要错位" : ""}。` +
        (hasReference
          ? "参考图只提供它承担的那部分信息，不要把它当成第二张原图，也不要把参考图的整体构图照搬进结果。"
          : ""),
    );
  }

  if (input.analysis.trim() && stage.id !== "analyze") {
    blocks.push(`## 原图分析（已有结论，直接引用）\n${input.analysis.trim()}`);
  }

  const selected = input.options.find((o) => o.id === input.selectedOptionId);
  if (selected && stage.id !== "direction") {
    blocks.push(
      `## 用户选定的方向\n标题：${selected.title}\n改什么：${selected.change}\n` +
        `成像结果：${selected.outcome}\n风险：${selected.risk}`,
    );
  }

  // 细化阶段里，用户输入本身就是"补充要求"，所以这里不做排除
  if (input.notes.length > 0) {
    blocks.push(
      `## 用户补充要求\n${input.notes.map((n) => `- ${n}`).join("\n")}`,
    );
  }

  if (input.focus) {
    // 【…】开头的是"结构化任务"（要 JSON），不是"改一处"。
    // 以前两种都塞进「只改这一处／最终重写完整提示词」的模板里，
    // 结果提示词自相矛盾：一边要 JSON，一边要它重写正文，
    // 模型通常听前者，于是待定项面板永远抓不到东西。
    const structured = input.focus.trim().startsWith("【");
    if (structured) {
      blocks.push(`## 本轮任务\n${input.focus}`);
    } else {
      if (input.artifact?.prompt.trim()) {
        blocks.push(
          `## 上一版完整提示词（仅用于定点修正）\n${input.artifact.prompt.trim()}`,
        );
      }
      blocks.push(
        `## 本轮修改重点（只改这一处）\n${input.focus}\n` +
          `除这一处之外，其余已确认内容保持一致；最终仍要重写为一条不依赖历史上下文的完整提示词。`,
      );
    }
  }

  if (usesPaintedHair(input)) blocks.push(hairTask(input));
  const language = promptLanguageBlock(input);
  if (language) blocks.push(language);
  blocks.push(`## 输出要求\n${TEXT_ONLY_RULE}\n${outputRequirement(input)}`);

  return blocks.join("\n\n");
}

function outputRequirement(input: TaskInput): string {
  const { stage, workflow } = input;
  if (stage.id === "analyze") {
    return (
      "按 analysis-framework 资产的九个维度逐项输出，每项一到三句，" +
      "只写画面中可见的事实。风格相关结论必须落到白平衡、曝光、反差、高光、锐度、噪点、压缩与景深。" +
      "最后单列「需要用户确认的点」，最多三条。不要给出修改建议。"
    );
  }

  if (stage.id === "direction") {
    const wantsSix = input.intake.outputMode?.includes("6 个差异化方向");
    const min = wantsSix ? 6 : (stage.minOptions ?? 2);
    const max = wantsSix ? 6 : (stage.maxOptions ?? 3);
    return (
      `输出 ${min}~${max} 个差异化方向。只输出一个 json 对象，结构如下：\n` +
      '{"options":[{"title":"方向标题","change":"改什么、保留什么",' +
      '"outcome":"可观察的成像结果","risk":"代价与风险",' +
      '"channel":"适配通道","recommended":true}]}\n' +
      "其中恰好一个 recommended 为 true。每个字段都用中文，不要输出 json 之外的任何文字。"
    );
  }

  if (stage.id === "compose") {
    if (usesPaintedHair(input)) return HAIR_OUTPUT;
    // 分步生成线换成三段契约：背景与景别陈设 / 身体互动特效 / 氛围层
    const steps = threeStepContract(input);
    if (steps) return steps;
    const extra =
      workflow.outputContract === "mj-prompt-en"
        ? "（1）中文方向说明（2）英文 Midjourney 提示词（3）参数矩阵清单（4）提交前 QA 清单"
        : workflow.outputContract === "complete-cn"
          ? `（1）一条独立、连续、可直接复制的${languageWord(input)}修图 Prompt（2）一行「喂给谁」建议`
          : "（1）中文四段式提示词（2）一行「喂给谁」建议";
    const markerNote =
      workflow.outputContract === "four-section-cn"
        ? "prompt 字段必须用四个中文标记分段：【保留项】【修改项】【禁止项】【参数】，" +
          "每个标记单独起一行，标记之间不要再夹别的小标题。" +
          "这段 prompt 的直接读者是 Gemini / Nano Banana：必须用 REFERENCE_0 指代底图，" +
          "用 REFERENCE_1...N 指代对应参考图，并在【修改项】逐张说明只借用什么。"
        : workflow.outputContract === "complete-cn"
          ? "prompt 字段内部只放一条完整自然语言 Prompt，不加标题、编号、代码围栏、规则解释或分析过程。" +
            "按范围声明、锁定项、具体修改、几何材质与空间关系、摄影融合、最高相关禁止项的顺序自然串联。" +
            "必须用 REFERENCE_0 指代底图，并用 REFERENCE_1...N 精确声明每张参考图只负责什么。"
          : "";
    const paramNote =
      workflow.outputContract === "mj-prompt-en"
        ? "params 至少覆盖 --ar 与风格化强度；checklist 给出提交前要确认的条目。"
        : "params 只放本次已有的输出比例、数量与编辑强度；没有明确值时可省略。";
    // MJ 的比例与参数必须落在同一行末尾，负向是 --no 追加，不是独立一段：
    // 因此让模型把正负面拆成 sections，由程序拼出可直接粘贴的完整一行。
    const mjNote =
      workflow.outputContract === "mj-prompt-en"
        ? "prompt 字段只放正面提示词正文，不要写 -- 参数；另用 sections 给出两段：" +
          '{"key":"正面提示词","body":"..."} 与 {"key":"负面提示词","body":"..."}。' +
          "负面只写逗号分隔的词，不要自己加 --no；所有 -- 参数放进 params。"
        : "";
    const requestedFormat = input.intake.outputMode ?? "";
    const wantsGrid =
      requestedFormat.includes("9 宫格方案") ||
      input.intake.taskType?.includes("九宫格策划");
    const formatNote = requestedFormat.includes("6 个差异化方向")
      ? "用户要求六个方向：prompt 先写一个共同母规则，再给六个在结构、尺度、材质或空间关系上至少两项不同的方向。"
      : wantsGrid
        ? "用户要求九宫格：prompt 先写共同母规则，再写九格差异；若是九格九环境，锁定同一人物、动作、机位、裁切与光影；只有用户明确选择九格九动作时才允许动作和机位变化。"
        : "";
    return (
      `只输出一个 json 对象，结构如下：\n` +
      '{"prompt":"最终提示词正文","channel":"喂给谁或如何提交","params":["参数行"],"checklist":["提交前检查项"]}\n' +
      `prompt 字段里要能直接看到：${extra}。` +
      `${markerNote}${formatNote}${paramNote}${mjNote}${NO_TRAILING_ADVICE} 不要输出 json 之外的任何文字。`
    );
  }

  if (stage.id === "detail") {
    // focus 前缀决定这一轮要哪种输出结构，而不是普通问答
    const focus = (input.focus ?? "").trim();
    if (focus.startsWith("【人设解析】")) return DETAIL_PERSONA;
    if (focus.startsWith("【资料收集】")) return DETAIL_RESEARCH;
    if (focus.startsWith("【待定项清单】")) return DETAIL_CHECKLIST;
    return (
      "回答用户的具体问题。如果用户的补充里缺了影响执行的关键信息，" +
      "最多追问三个问题；否则直接给出判断与两三种可选写法。不要输出 json。"
    );
  }

  return "简洁作答。不要输出 json。";
}

/**
 * 参考图拆解任务的正文。
 * 与 buildStageTask 分开写：这一步问的是「参考图里有什么可迁移的」，
 * 原图不在请求里，也不该让模型去描述原图。
 */
export function buildExtractTask(input: TaskInput): string {
  const references = input.images.filter((image) => image.role === "reference");
  let referenceIndex = 0;
  const lines = references.map((image) => {
    referenceIndex += 1;
    return `- 参考图${referenceIndex}：${image.name}`;
  });

  const blocks = [
    "## 本次任务\n逐张拆解参考图，列出所有可以迁移到另一张照片的成分。",
    `## 工作流\n${input.workflow.name}`,
  ];

  const filled = visibleFields(
    input.workflow.stages.find((s) => s.id === "intake") ?? input.stage,
    input.intake,
  )
    .map((field) => {
      const value = (input.intake[field.key] ?? "").trim();
      return value
        ? `- ${FIELD_LABELS[field.key] ?? field.label}：${humanize(value)}`
        : null;
    })
    .filter((line): line is string => line !== null);
  if (filled.length > 0) blocks.push(`## 用户需求\n${filled.join("\n")}`);

  if (input.directives.length > 0) {
    blocks.push(
      `## 已启用的专项规则（必须遵守）\n${input.directives
        .map((d) => `- ${d.label}：${d.instruction}`)
        .join("\n")}`,
    );
  }

  blocks.push(
    `## 图片\n本请求只附带参考图，按顺序为：\n${lines.join("\n")}\n` +
      `原图不在本次请求中，不要描述或假设原图的内容。`,
  );

  blocks.push(
    "## 输出要求\n" +
      `${TEXT_ONLY_RULE}\n` +
      "只输出一个 json 对象，结构如下：\n" +
      '{"items":[{"category":"背景","label":"短标题","description":"可迁移的具体描述","source":"参考图1"}]}\n' +
      "规则：\n" +
      `- category 只能取这六个值之一：背景、元素、特效、光线、色调、材质\n` +
      "- 每个类别最多 4 条，总数不超过 20 条\n" +
      "- description 写可观察的视觉语言：材质与表面特征、颜色关系、光的软硬与方向、颗粒与压缩特征、特效形态\n" +
      "- 不写「高级」「氛围感」这类形容词，不写可识别的具体人物、品牌或 Logo\n" +
      "- 提取的是可以迁移的手法，不是参考图独有的表达；不要把整张构图当成一项\n" +
      "- source 必须是上面列出的参考图编号之一\n" +
      "不要输出 json 之外的任何文字。",
  );

  if (usesPaintedHair(input)) blocks.push(hairTask(input, true));
  return blocks.join("\n\n");
}
