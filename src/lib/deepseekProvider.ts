import type { WorkflowStage } from '../workflows/types.ts'
import { effectiveAssets, useAssetStore } from './assetStore.ts'
import { resolveDirectives } from './directives.ts'
import { assertSupportedImages, assertWithinLimit } from './image.ts'
import { chat, chatJson, LlmError } from './llm/client.ts'
import {
  artifactSchema,
  directionsSchema,
  referenceItemsSchema,
  type RawDirections,
  type RawReferenceItems,
} from './llm/schemas.ts'
import { buildExtractTask, buildStageTask } from './llm/task.ts'
import type { ContentPart, LlmMessage, ThinkingMode } from './llm/types.ts'
import { buildPrefix } from './prefix.ts'
import { REFERENCE_CATEGORIES } from './wizardTypes.ts'
import type {
  Artifact,
  DirectionOption,
  Provider,
  ReferenceCategory,
  ReferenceItem,
  WizardContext,
  WizardImage,
} from './wizardTypes.ts'
import { createId } from './wizardTypes.ts'

/** 非思考模式下用一个偏低但不为零的温度，兼顾 JSON 稳定性与表达多样性。 */
const TEMPERATURE = 0.3

type ThinkingOptions = { thinking: ThinkingMode; effort?: 'low' | 'high' | 'max' }

function stageOf(ctx: WizardContext, id: string): WorkflowStage {
  const stage = ctx.workflow.stages.find((s) => s.id === id)
  if (!stage) throw new Error(`工作流 ${ctx.workflow.id} 缺少阶段 ${id}`)
  return stage
}

function thinkingOf(stage: WorkflowStage): ThinkingOptions {
  return stage.thinking.mode === 'enabled'
    ? { thinking: 'enabled', effort: stage.thinking.effort }
    : { thinking: 'disabled' }
}

/**
 * 图片按阶段分化：
 * - 原图分析只看原图，参考图会干扰对原图事实层的判断
 * - 生成提示词要同时看原图和参考图，否则不知道要置入的物体长什么样
 * - 其余阶段的提示词里已有分析结论，再传图只会白烧 token
 */
function imagesFor(ctx: WizardContext, stageId: string): WizardImage[] {
  if (stageId === 'analyze') {
    return ctx.images.filter((image) => image.role === 'original')
  }
  if (stageId === 'compose') return ctx.images
  return []
}

function assertImagesReady(images: WizardImage[]): void {
  assertSupportedImages(images)
  assertWithinLimit(images)
}

/**
 * 消息结构固定为「system = 冻结资产，user = 变动内容」。
 * 前缀必须逐字不变，否则 DeepSeek 的上下文缓存会全部落空。
 */
function messagesFor(
  ctx: WizardContext,
  images: WizardImage[],
  task: string,
): LlmMessage[] {
  const assets = effectiveAssets(useAssetStore.getState().overrides)
  const prefix = buildPrefix(ctx.workflow, assets)

  const parts: ContentPart[] = [{ type: 'text', text: task }]
  for (const image of images) {
    parts.push({
      type: 'image_url',
      image_url: { url: image.dataUrl, detail: 'high' },
    })
  }

  return [
    { role: 'system', content: prefix },
    { role: 'user', content: parts },
  ]
}

function taskFor(ctx: WizardContext, stageId: string, focus?: string): string {
  return buildStageTask({
    workflow: ctx.workflow,
    stage: stageOf(ctx, stageId),
    intake: ctx.intake,
    images: imagesFor(ctx, stageId),
    analysis: ctx.analysis,
    options: ctx.options,
    selectedOptionId: ctx.selectedOptionId,
    notes: ctx.notes,
    artifact: ctx.artifact,
    directives: resolveDirectives(ctx.workflow, ctx.intake),
    selectedReferenceItems: ctx.selectedReferenceItems,
    focus,
  })
}

function messagesForStage(ctx: WizardContext, stageId: string, focus?: string): LlmMessage[] {
  return messagesFor(ctx, imagesFor(ctx, stageId), taskFor(ctx, stageId, focus))
}

/** 把模型给的类别词归一到固定集合，近义词不该导致整批结果作废。 */
function normalizeCategory(raw: string): ReferenceCategory {
  return REFERENCE_CATEGORIES.find((category) => raw.includes(category)) ?? '元素'
}

function normalizeReferenceItems(raw: RawReferenceItems['items']): ReferenceItem[] {
  const counters = new Map<string, number>()
  return raw.map((item, index) => {
    const category = normalizeCategory(item.category)
    const next = (counters.get(category) ?? 0) + 1
    counters.set(category, next)
    return {
      id: `ref-${index + 1}-${category}-${next}`,
      category,
      label: cleanTitle(item.label) || item.label.trim(),
      description: item.description.trim(),
      source: item.source.trim(),
    }
  })
}

/** 保证恰好一个推荐项：模型标了多个时只保留第一个，一个都没标时落到第一个。 */
/** 模型有时会在标题里自带「（推荐）」，而界面另有徽章，去掉以免重复。 */
function cleanTitle(title: string): string {
  return title.replace(/\s*[（(]\s*推荐\s*[)）]\s*$/u, '').trim()
}

function normalizeDirections(
  ctx: WizardContext,
  raw: RawDirections['options'],
): DirectionOption[] {
  const options: DirectionOption[] = raw.map((item, index) => ({
    id: item.id?.trim() || `${ctx.workflow.id}-dir-${index + 1}`,
    title: cleanTitle(item.title) || item.title.trim(),
    change: item.change.trim(),
    outcome: item.outcome.trim(),
    risk: item.risk.trim(),
    channel: item.channel?.trim() || '—',
    recommended: item.recommended === true,
  }))

  const firstRecommended = options.findIndex((option) => option.recommended)
  const keep = firstRecommended === -1 ? 0 : firstRecommended
  return options.map((option, index) => ({ ...option, recommended: index === keep }))
}

/** 两次都没解析成功时的降级：把原始输出做成一张卡片，流程不中断。 */
function degradedDirection(result: { raw: string; reason: string }): DirectionOption {
  return {
    id: createId('degraded'),
    title: '（未能解析为结构化选项）',
    change: '模型两次都没有返回可解析的结构，下面是它的原始输出',
    outcome: result.raw.trim().slice(0, 1200) || '（模型返回了空内容）',
    risk: `解析失败原因：${result.reason}`,
    channel: '—',
    recommended: true,
  }
}

function fallbackChannel(ctx: WizardContext): string {
  return ctx.workflow.outputContract === 'mj-prompt-en'
    ? 'Midjourney 官网或 Discord，由你本人手动提交（程序不代为提交）'
    : '喂给 Codex imagegen 或 GPT Image 2 的编辑接口，把原图作为 REFERENCE_0 一并传入'
}

async function composeArtifact(ctx: WizardContext, focus?: string): Promise<Artifact> {
  const stage = stageOf(ctx, 'compose')
  assertImagesReady(imagesFor(ctx, 'compose'))

  const result = await chatJson(
    {
      messages: messagesForStage(ctx, 'compose', focus),
      ...thinkingOf(stage),
      maxTokens: 4096,
    },
    artifactSchema,
  )

  if (result.ok) {
    return {
      prompt: result.data.prompt.trim(),
      channel: result.data.channel?.trim() || fallbackChannel(ctx),
      params: result.data.params?.map((p) => p.trim()).filter(Boolean),
      checklist: result.data.checklist?.map((c) => c.trim()).filter(Boolean),
    }
  }

  return {
    prompt: result.raw.trim() || '（模型没有返回内容）',
    channel: `模型未返回结构化结果（${result.reason}），以上为原始输出`,
  }
}

export const deepseekProvider: Provider = {
  kind: 'live',

  async analyze(ctx) {
    const stage = stageOf(ctx, 'analyze')
    assertImagesReady(imagesFor(ctx, 'analyze'))

    const result = await chat({
      messages: messagesForStage(ctx, 'analyze'),
      ...thinkingOf(stage),
      temperature: TEMPERATURE,
      maxTokens: 2048,
    })

    const text = result.content.trim()
    if (!text) throw new LlmError('模型返回了空内容，请重试')
    return text
  },

  /**
   * 只把参考图发给模型，原图不参与。
   * 让模型看原图会让它顺手描述原图，而这一步要的是「参考图里有什么可搬的」。
   */
  async extractReferences(ctx) {
    const references = ctx.images.filter((image) => image.role === 'reference')
    if (references.length === 0) return []
    assertImagesReady(references)

    const stage = stageOf(ctx, 'analyze')
    const task = buildExtractTask({
      workflow: ctx.workflow,
      stage,
      intake: ctx.intake,
      images: references,
      analysis: '',
      options: [],
      selectedOptionId: null,
      notes: [],
      artifact: null,
      directives: resolveDirectives(ctx.workflow, ctx.intake),
    })

    const result = await chatJson(
      {
        messages: messagesFor(ctx, references, task),
        ...thinkingOf(stage),
        maxTokens: 3072,
      },
      referenceItemsSchema,
    )

    return result.ok ? normalizeReferenceItems(result.data.items) : []
  },

  async suggestDirections(ctx) {
    const stage = stageOf(ctx, 'direction')
    const result = await chatJson(
      {
        messages: messagesForStage(ctx, 'direction'),
        ...thinkingOf(stage),
        // 三条选项各含五个字段，2048 偏紧，截断会直接导致 JSON 解析失败
        maxTokens: 4096,
      },
      directionsSchema,
    )

    return result.ok
      ? normalizeDirections(ctx, result.data.options)
      : [degradedDirection(result)]
  },

  async askDetail(ctx) {
    const stage = stageOf(ctx, 'detail')
    // 用户这条输入已经写进 ctx.notes，会作为「用户补充要求」进入请求，
    // 这里不再单独拼一次，避免同一句话在提示词里出现两遍。
    const result = await chat({
      messages: messagesForStage(ctx, 'detail'),
      ...thinkingOf(stage),
      temperature: TEMPERATURE,
      maxTokens: 1024,
    })
    return result.content.trim() || '（模型没有返回内容）'
  },

  async compose(ctx) {
    return composeArtifact(ctx)
  },

  async iterate(ctx, feedback) {
    return composeArtifact(ctx, feedback)
  },
}
