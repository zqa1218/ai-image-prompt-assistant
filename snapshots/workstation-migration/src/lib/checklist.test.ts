import { beforeEach, expect, it } from 'vitest'
import { checklistSummary, parseChecklist } from './checklist.ts'
import { MOCK_PROVIDER, setProvider, useWizard } from './wizardStore.ts'

const text = JSON.stringify({ items: [{ q: '岩石大小', why: '影响遮挡', options: [{ label: '小', note: '不挡脚部' }, { label: '大', note: '突出主体' }], recommended: 0 }] })
const state = () => useWizard.getState()
beforeEach(() => { setProvider(MOCK_PROVIDER); state().reset(); state().start('refine') })

it('解析待定项并仅串联显式选择；非法推荐项回退且不自动选择', () => {
  const items = parseChecklist('```json\n' + text + '\n```')
  expect(checklistSummary(items, {})).toBe('')
  expect(checklistSummary(items, { 0: 0 })).toBe('待定项确认：岩石大小 → 小（不挡脚部）')
  expect(checklistSummary(items, { 0: 99 })).toBe('')
  expect(parseChecklist(text.replace('"recommended":0', '"recommended":99'))[0].recommended).toBe(0)
  expect(() => parseChecklist('not json')).toThrow('格式不正确')
})

it('抓取与确认贯通 store，需求写入且旧产物作废', async () => {
  setProvider({ ...MOCK_PROVIDER, askChecklist: async () => text })
  await state().loadChecklist()
  expect(state().questions).toHaveLength(1)
  expect(state().notes).toHaveLength(0)
  useWizard.setState({ artifact: { prompt: 'old', channel: 'test' }, records: { compose: { status: 'ready' } } })
  state().answerChecklist({ 0: 1 })
  expect(state().notes[0]).toContain('大（突出主体）')
  expect(state().messages[0].role).toBe('user')
  expect(state().questions).toHaveLength(0)
  expect(state().artifact).toBeNull()
})

it('重复点击不重复调用；切换任务后的迟到回复不写入', async () => {
  let resolve!: (text: string) => void
  let calls = 0
  setProvider({ ...MOCK_PROVIDER, askChecklist: () => { calls++; return new Promise(r => { resolve = r }) } })
  const pending = state().loadChecklist()
  await state().loadChecklist()
  expect(calls).toBe(1)
  state().start('recompose')
  resolve(text)
  await pending
  expect(state().questions).toHaveLength(0)
  expect(state().checklistBusy).toBe(false)
})

it('原图需求变化使在途待定项失效，错误可重试', async () => {
  let resolve!: (text: string) => void
  setProvider({ ...MOCK_PROVIDER, askChecklist: () => new Promise(r => { resolve = r }) })
  const pending = state().loadChecklist()
  state().setIntake('requirement', 'new')
  resolve(text)
  await pending
  expect(state().questions).toHaveLength(0)
  setProvider({ ...MOCK_PROVIDER, askChecklist: async () => 'invalid' })
  await state().loadChecklist()
  expect(state().checklistError).toContain('格式不正确')
  expect(state().checklistBusy).toBe(false)
  setProvider({ ...MOCK_PROVIDER, askChecklist: async () => text })
  await state().loadChecklist()
  expect(state().checklistError).toBeNull()
  expect(state().questions).toHaveLength(1)
})

it('参考图分工只改目标图，作废旧产物并随存档载入保留', () => {
  const image = { name: 'a.png', dataUrl: 'data:image/png;base64,AA', width: 1, height: 1, bytes: 1 }
  state().addReference(image)
  state().addReference({ ...image, name: 'b.png' })
  useWizard.setState({ artifact: { prompt: 'old', channel: 'test' } })
  state().setReferenceNote(1, '只借电弧颜色')
  expect(state().references[0].note).toBeUndefined()
  expect(state().references[1].note).toBe('只借电弧颜色')
  expect(state().artifact).toBeNull()
  const references = state().references
  state().setReferenceNote(99, 'bad')
  expect(state().references).toBe(references)
  state().applyArchive({ workflowId: 'refine-steps', intake: {}, original: null, references })
  expect(state().references[1].note).toBe('只借电弧颜色')
})
