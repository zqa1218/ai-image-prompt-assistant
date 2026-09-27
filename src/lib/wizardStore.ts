import { create } from 'zustand'
import { getWorkflow } from '../workflows/index.ts'
import type { Workflow } from '../workflows/types.ts'
import { deepseekProvider } from './deepseekProvider.ts'
import { mockProvider } from './mockProvider.ts'
import type {
  Artifact,
  ChatMessage,
  DirectionOption,
  ImageRef,
  Provider,
  ReferenceItem,
  StageRecord,
  WizardContext,
  WizardImage,
} from './wizardTypes.ts'
import { createId } from './wizardTypes.ts'

/** 默认走真实模型；设为 mock 可在没有 key 时演示流程。 */
let provider: Provider = deepseekProvider

export function setProvider(next: Provider) {
  provider = next
  useWizard.setState({ providerKind: next.kind })
}

export function getProvider(): Provider {
  return provider
}

export const MOCK_PROVIDER = mockProvider
export const LIVE_PROVIDER = deepseekProvider

/** 自动执行（进入即跑）的阶段。接收、细化、迭代由用户驱动。 */
const AUTO_STAGES = new Set(['analyze', 'direction', 'compose'])

export type WizardState = {
  providerKind: 'mock' | 'live'
  workflowId: string | null
  stageIndex: number
  records: Record<string, StageRecord>
  intake: Record<string, string>
  original: WizardImage | null
  references: WizardImage[]
  /** 从参考图拆解出的可迁移项 */
  referenceItems: ReferenceItem[]
  /** 已勾选要导入的项 id */
  selectedReferenceItems: string[]
  options: DirectionOption[]
  selectedOptionId: string | null
  notes: string[]
  artifact: Artifact | null
  messages: ChatMessage[]
  notice: string | null
  busy: boolean

  start: (workflowId: string) => void
  reset: () => void
  setIntake: (key: string, value: string) => void
  setOriginal: (image: ImageRef | null) => void
  addReference: (image: ImageRef) => void
  removeReference: (index: number) => void
  toggleReferenceItem: (id: string) => void
  goTo: (index: number) => void
  advance: () => Promise<void>
  rerun: (index?: number) => Promise<void>
  selectOption: (id: string) => void
  addNote: (text: string) => Promise<string | null>
  sendFeedback: (text: string) => Promise<void>
}

const initial = {
  providerKind: provider.kind as 'mock' | 'live',
  workflowId: null as string | null,
  stageIndex: 0,
  records: {} as Record<string, StageRecord>,
  intake: {} as Record<string, string>,
  original: null as WizardImage | null,
  references: [] as WizardImage[],
  referenceItems: [] as ReferenceItem[],
  selectedReferenceItems: [] as string[],
  options: [] as DirectionOption[],
  selectedOptionId: null as string | null,
  notes: [] as string[],
  artifact: null as Artifact | null,
  messages: [] as ChatMessage[],
  notice: null as string | null,
  busy: false,
}

function workflowOf(state: WizardState): Workflow {
  if (!state.workflowId) throw new Error('尚未选择工作流')
  return getWorkflow(state.workflowId)
}

function contextOf(state: WizardState): WizardContext {
  const workflow = workflowOf(state)
  return {
    workflow,
    intake: state.intake,
    images: allImages(state),
    analysis: (state.records['analyze']?.output as string | undefined) ?? '',
    options: state.options,
    selectedOptionId: state.selectedOptionId,
    notes: state.notes,
    artifact: state.artifact,
    selectedReferenceItems: state.referenceItems.filter((item) =>
      state.selectedReferenceItems.includes(item.id),
    ),
  }
}

/** 原图永远排在参考图前面，编号顺序即上传顺序。 */
export function allImages(state: WizardState): WizardImage[] {
  return [...(state.original ? [state.original] : []), ...state.references]
}

function withReference(image: ImageRef): WizardImage {
  return { ...image, role: 'reference' }
}

/** 第 index 步之后的所有产出都作废；返回被清掉的阶段标题。 */
function invalidateAfter(state: WizardState, index: number) {
  const workflow = workflowOf(state)
  const records = { ...state.records }
  const cleared: string[] = []
  const patch: Partial<WizardState> = {}

  const idx = (id: string) => workflow.stages.findIndex((s) => s.id === id)

  if (index < idx('analyze') && records['analyze']?.status === 'ready') {
    records['analyze'] = { status: 'idle' }
    cleared.push('原图分析')
  }
  if (index < idx('analyze') && state.referenceItems.length > 0) {
    records['extract'] = { status: 'idle' }
    patch.referenceItems = []
    patch.selectedReferenceItems = []
    cleared.push('参考图拆解')
  }
  if (index < idx('direction') && (state.options.length > 0 || state.selectedOptionId)) {
    records['direction'] = { status: 'idle' }
    patch.options = []
    patch.selectedOptionId = null
    cleared.push('方向建议')
  }
  if (index < idx('detail') && state.notes.length > 0) {
    patch.notes = []
    cleared.push('细化')
  }
  if (index < idx('compose') && (state.artifact || records['compose']?.status === 'ready')) {
    records['compose'] = { status: 'idle' }
    patch.artifact = null
    cleared.push('生成提示词')
  }
  if (index < idx('iterate') && state.messages.length > 0) {
    patch.messages = []
    cleared.push('迭代')
  }

  return { records, patch, cleared }
}

export const useWizard = create<WizardState>()((set, get) => {
  async function runStage(index: number) {
    const state = get()
    if (!state.workflowId) return
    const workflow = workflowOf(state)
    const stage = workflow.stages[index]
    if (!stage || !AUTO_STAGES.has(stage.id)) return

    const ctx = contextOf(state)
    set((s) => ({
      busy: true,
      records: { ...s.records, [stage.id]: { status: 'running' } },
      notice: null,
    }))

    try {
      if (stage.id === 'analyze') {
        const text = await provider.analyze(ctx)

        // 有参考图时顺带拆解出可迁移项。拆解失败不该把已经成功的分析一起判失败。
        let items: ReferenceItem[] = []
        if (ctx.images.some((image) => image.role === 'reference')) {
          try {
            items = await provider.extractReferences(ctx)
          } catch {
            items = []
          }
        }
        // 显式标注类型：条件表达式里的字面量会被拓宽成 string，导致不符合 StageRecord
        const extractRecord: StageRecord =
          items.length > 0 ? { status: 'ready', output: items } : { status: 'idle' }
        set((s) => ({
          busy: false,
          referenceItems: items,
          selectedReferenceItems: [],
          records: {
            ...s.records,
            analyze: { status: 'ready', output: text },
            extract: extractRecord,
          },
        }))
      } else if (stage.id === 'direction') {
        const options = await provider.suggestDirections(ctx)
        set((s) => ({
          busy: false,
          options,
          selectedOptionId: null,
          records: { ...s.records, direction: { status: 'ready', output: options } },
        }))
      } else if (stage.id === 'compose') {
        const artifact = await provider.compose(ctx)
        set((s) => ({
          busy: false,
          artifact,
          records: { ...s.records, compose: { status: 'ready', output: artifact } },
        }))
      }
    } catch (err) {
      set((s) => ({
        busy: false,
        records: {
          ...s.records,
          [stage.id]: {
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          },
        },
      }))
    }
  }

  async function runIfNeeded(index: number) {
    const state = get()
    const workflow = workflowOf(state)
    const stage = workflow.stages[index]
    if (!stage || !AUTO_STAGES.has(stage.id)) return
    if (state.records[stage.id]?.status === 'ready') return
    await runStage(index)
  }

  return {
    ...initial,

    start(workflowId) {
      // 带默认值的字段（如输出规格）在进入时预填，用户可以改
      const workflow = getWorkflow(workflowId)
      const intakeStage = workflow.stages.find((stage) => stage.id === 'intake')
      const intake: Record<string, string> = {}
      for (const field of intakeStage?.fields ?? []) {
        if (field.defaultValue !== undefined) intake[field.key] = field.defaultValue
      }
      set({ ...initial, workflowId, intake })
    },

    reset() {
      set({ ...initial })
    },

    setIntake(key, value) {
      const state = get()
      const { records, patch } = invalidateAfter(state, 0)
      set({ ...patch, records, intake: { ...state.intake, [key]: value } })
    },

    setOriginal(image) {
      const state = get()
      const { records, patch } = invalidateAfter(state, 0)
      set({ ...patch, records, original: image ? { ...image, role: 'original' } : null })
    },

    addReference(image) {
      const state = get()
      const { records, patch } = invalidateAfter(state, 0)
      set({ ...patch, records, references: [...state.references, withReference(image)] })
    },

    removeReference(index) {
      const state = get()
      const { records, patch, cleared } = invalidateAfter(state, 0)
      set({
        ...patch,
        records,
        references: state.references.filter((_, i) => i !== index),
        notice: cleared.length ? `参考图有变化，后续的 ${cleared.join('、')} 已作废。` : null,
      })
    },

    toggleReferenceItem(id) {
      const state = get()
      // 勾选变化会影响方向与提示词，所以从分析之后的下游都要作废
      const { records, patch } = invalidateAfter(state, 1)
      set({
        ...patch,
        records,
        selectedReferenceItems: state.selectedReferenceItems.includes(id)
          ? state.selectedReferenceItems.filter((item) => item !== id)
          : [...state.selectedReferenceItems, id],
      })
    },

    goTo(index) {
      const state = get()
      if (!state.workflowId) return
      const workflow = workflowOf(state)
      if (index < 0 || index >= workflow.stages.length) return
      if (index === state.stageIndex) return

      const { records, patch, cleared } = invalidateAfter(state, index)
      set({
        ...patch,
        records,
        stageIndex: index,
        notice: cleared.length
          ? `已回到第 ${index + 1} 步「${workflow.stages[index].title}」，` +
            `后续的 ${cleared.join('、')} 已作废，需要重新推进。`
          : null,
      })
    },

    async advance() {
      const state = get()
      if (!state.workflowId) return
      const workflow = workflowOf(state)
      const stage = workflow.stages[state.stageIndex]

      // 方向阶段：用户没点选时按推荐项继续，避免卡死
      if (stage.id === 'direction' && !state.selectedOptionId && state.options.length > 0) {
        const pick = state.options.find((o) => o.recommended) ?? state.options[0]
        set({
          selectedOptionId: pick.id,
          notice: `你没有选择方向，已按推荐项「${pick.title}」继续。`,
        })
      }

      const next = state.stageIndex + 1
      if (next >= workflow.stages.length) return
      set({ stageIndex: next })
      await runIfNeeded(next)
    },

    async rerun(index) {
      const state = get()
      const target = index ?? state.stageIndex
      const { records, patch, cleared } = invalidateAfter(state, target - 1)
      set({
        ...patch,
        records,
        stageIndex: target,
        notice: cleared.length ? `已重跑，后续的 ${cleared.join('、')} 已作废。` : null,
      })
      await runStage(target)
    },

    selectOption(id) {
      set({ selectedOptionId: id, notice: null })
    },

    async addNote(text) {
      const state = get()
      const trimmed = text.trim()
      if (!trimmed) return null
      const ctx = contextOf(state)
      const message: ChatMessage = { id: createId('m'), role: 'user', text: trimmed }
      set((s) => ({ notes: [...s.notes, trimmed], messages: [...s.messages, message], busy: true }))
      try {
        const reply = await provider.askDetail(ctx, trimmed)
        set((s) => ({
          busy: false,
          messages: [
            ...s.messages,
            { id: createId('m'), role: 'assistant', text: reply },
          ],
        }))
        return reply
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        set((s) => ({
          busy: false,
          messages: [...s.messages, { id: createId('m'), role: 'assistant', text: `出错：${error}` }],
        }))
        return null
      }
    },

    async sendFeedback(text) {
      const state = get()
      const trimmed = text.trim()
      if (!trimmed || !state.artifact) return
      const ctx = contextOf(state)
      set((s) => ({
        busy: true,
        messages: [...s.messages, { id: createId('m'), role: 'user', text: trimmed }],
      }))
      try {
        const artifact = await provider.iterate(ctx, trimmed)
        set((s) => ({
          busy: false,
          artifact,
          records: { ...s.records, compose: { status: 'ready', output: artifact } },
          messages: [
            ...s.messages,
            {
              id: createId('m'),
              role: 'assistant',
              text: '已按你的反馈重新编译提示词，本轮只改动了这一处。',
            },
          ],
        }))
      } catch (err) {
        set((s) => ({
          busy: false,
          messages: [
            ...s.messages,
            {
              id: createId('m'),
              role: 'assistant',
              text: `出错：${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        }))
      }
    },
  }
})

export function stageStatus(state: WizardState, stageId: string) {
  return state.records[stageId]?.status ?? 'idle'
}

export function selectedOption(state: WizardState): DirectionOption | null {
  if (!state.selectedOptionId) return null
  return state.options.find((o) => o.id === state.selectedOptionId) ?? null
}
