import { afterEach, expect, it, vi } from 'vitest'
import { deepseekProvider } from './deepseekProvider.ts'
import { REFINE, RECOMPOSE } from '../workflows/index.ts'
import { parseSections } from './promptSections.ts'
import type { WizardContext } from './wizardTypes.ts'

afterEach(() => vi.unstubAllGlobals())

it('未选置入物体时保留参考图编号，只有置入物体会清理来源措辞', async () => {
  const prompt = '保持 REFERENCE_0 中人物不变，在右后方放置灰色岩石，外形与参考图1保持一致。'
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ prompt, channel: 'test' }) } }], usage: {},
  }))))
  const ctx: WizardContext = {
    workflow: REFINE, intake: { requirement: '调整背景', taskType: '替换背景' },
    images: [], analysis: '', options: [], selectedOptionId: null,
    notes: [], artifact: null, selectedReferenceItems: [],
  }
  expect((await deepseekProvider.compose(ctx)).prompt).toBe(prompt)
  const placed = await deepseekProvider.compose({ ...ctx, intake: { ...ctx.intake, taskType: '置入物体' } })
  expect(placed.prompt).not.toMatch(/REFERENCE|参考图/)
  expect(placed.prompt).toContain('右后方放置灰色岩石')
  const withReference = await deepseekProvider.compose({ ...ctx, intake: { ...ctx.intake, taskType: '置入物体', referencePolicy: '参考图参与' } })
  expect(withReference.prompt).toBe(prompt)
})

it('重构结果保留正负面分块、多方向与完整参数行，不被 schema 丢弃', async () => {
  const data = {
    prompt: 'a studio portrait',
    sections: [
      { key: '正面提示词 · 方向1', body: 'a studio portrait [cite:1]' },
      { key: '正面提示词 · 方向2', body: 'a moonlit portrait' },
      { key: '负面提示词', body: 'blur, watermark' },
    ],
    params: ['--ar 3:4', '--stylize 250'],
    checklist: ['检查人物'],
  }
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(data) } }], usage: {},
  }))))
  const ctx: WizardContext = {
    workflow: RECOMPOSE, intake: {}, images: [], analysis: '', options: [], selectedOptionId: null,
    notes: [], artifact: null, selectedReferenceItems: [],
  }
  const artifact = await deepseekProvider.compose(ctx)
  const sections = parseSections(artifact.prompt)!
  expect(sections[0]).toEqual({ key: '完整一行（可直接粘贴）', body: 'a studio portrait --ar 3:4 --stylize 250 --no blur, watermark' })
  expect(sections.find(s => s.key === '正面提示词 · 方向2')?.body).toBe('a moonlit portrait')
  expect(sections.find(s => s.key === '负面提示词')?.body).toBe('blur, watermark')
  expect(artifact.prompt).not.toContain('[cite:')
  expect(artifact.params).toEqual(data.params)
  expect(artifact.checklist).toEqual(data.checklist)
})

it('待定项调用使用专属输出契约，不混入最终提示词改写要求', async () => {
  let body: any
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    body = JSON.parse(init.body)
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[]}' } }], usage: {} }))
  }))
  await deepseekProvider.askChecklist!({ workflow: REFINE, intake: {}, images: [], analysis: '', options: [], selectedOptionId: null, notes: [], artifact: null, selectedReferenceItems: [] })
  expect(JSON.stringify(body.messages)).toContain('【待定项清单】')
  expect(JSON.stringify(body.messages)).toContain('recommended')
  expect(JSON.stringify(body.messages)).not.toContain('最终仍要重写')
})

it('所有阶段和 JSON 重试共用图片会话，且每轮保留两份 Skill 和完整输入', async () => {
  const bodies: any[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    bodies.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ choices: [{ message: { content: '测试回复' } }], usage: {} }))
  }))
  const ctx: WizardContext = {
    workflow: REFINE, intake: { requirement: '置入岩石', taskType: '置入物体' },
    images: [{ name: 'base.png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=', role: 'original', width: 1, height: 1, bytes: 8 }],
    analysis: '底图分析', options: [], selectedOptionId: null, notes: ['保留人物'], artifact: null, selectedReferenceItems: [],
  }
  await deepseekProvider.analyze(ctx)
  await deepseekProvider.suggestDirections(ctx)
  await deepseekProvider.askDetail(ctx, '保留人物')
  await deepseekProvider.compose(ctx)
  expect(bodies.length).toBe(6)
  expect(new Set(bodies.map((body) => body.conversationId)).size).toBe(1)
  for (const body of bodies) {
    expect(body.messages[0].content).toContain('真人 Cosplay 摄影后期 Prompt 编译母规则')
    expect(body.messages[0].content).toContain('仅环境物品')
    expect(JSON.stringify(body.messages)).toContain('置入岩石')
    expect(body.messages[1].content.some((part: any) => part.type === 'image_url')).toBe(true)
  }
})
