import type { Workflow } from '../workflows/types.ts'

export type StageStatus = 'idle' | 'running' | 'ready' | 'error'

export type ImageRef = {
  name: string
  /** 原图的 data URL。M3 会在这里插入压缩与体积预检。 */
  dataUrl: string
  width: number
  height: number
  bytes: number
  /** 压缩前的原始体积，用于在界面提示"已压缩"。 */
  originalBytes?: number
  /** 原始文件类型，用于在界面提示"格式已转换"。 */
  sourceMime?: string
}

export type ImageRole = 'original' | 'reference'

/** 带角色信息的图片。原图始终是 REFERENCE_0，参考图按顺序编号。 */
export type WizardImage = ImageRef & { role: ImageRole }

export function imageLabel(image: WizardImage, referenceIndex: number): string {
  return image.role === 'original' ? '原图' : `参考图${referenceIndex}`
}

/** 方向卡片：四个必填字段对应"改什么 / 成像结果 / 代价与风险 / 适配通道"。 */
export type DirectionOption = {
  id: string
  title: string
  change: string
  outcome: string
  risk: string
  channel: string
  recommended: boolean
}

/** 从参考图里可以迁移过来的成分类别。 */
export const REFERENCE_CATEGORIES = ['背景', '元素', '特效', '光线', '色调', '材质'] as const
export type ReferenceCategory = (typeof REFERENCE_CATEGORIES)[number]

/**
 * 从参考图提取出的一个可迁移项。
 * 描述的是可迁移的视觉语言，不是参考图里的具体识别对象。
 */
export type ReferenceItem = {
  id: string
  category: ReferenceCategory
  label: string
  description: string
  /** 来自哪张参考图，如「参考图1」 */
  source: string
}

export type Artifact = {
  /** 最终提示词正文（A 线是中文四段式，B 线是英文 MJ 提示词） */
  prompt: string
  /** 「喂给谁」或提交方式 */
  channel: string
  /** B 线的参数矩阵，A 线的参数行 */
  params?: string[]
  /** B 线的提交前 QA 清单 */
  checklist?: string[]
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
}

export type StageRecord = {
  status: StageStatus
  error?: string
  output?: string | DirectionOption[] | ReferenceItem[] | Artifact
}

/** 传给模型提供方的完整上下文。 */
export type WizardContext = {
  workflow: Workflow
  intake: Record<string, string>
  /** 顺序固定为「原图在前，参考图在后」 */
  images: WizardImage[]
  analysis: string
  options: DirectionOption[]
  selectedOptionId: string | null
  notes: string[]
  artifact: Artifact | null
  /** 用户从参考图勾选要导入的项 */
  selectedReferenceItems: ReferenceItem[]
}

export type Provider = {
  /** mock = M2 占位数据；live = 真实模型调用。用于在界面明确标注。 */
  kind: 'mock' | 'live'
  analyze(ctx: WizardContext): Promise<string>
  /** 从参考图提取可迁移的成分；没有参考图时返回空数组 */
  extractReferences(ctx: WizardContext): Promise<ReferenceItem[]>
  suggestDirections(ctx: WizardContext): Promise<DirectionOption[]>
  askDetail(ctx: WizardContext, question: string): Promise<string>
  compose(ctx: WizardContext): Promise<Artifact>
  iterate(ctx: WizardContext, feedback: string): Promise<Artifact>
}

/** 阶段产出按 id 索引，方便回退时精确作废。 */
export type StageOutputs = {
  analyze?: string
  extract?: ReferenceItem[]
  direction?: DirectionOption[]
  compose?: Artifact
}

export function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}
