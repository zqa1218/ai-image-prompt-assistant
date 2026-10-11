import { afterEach, expect, it, vi } from 'vitest'
import { deepseekProvider } from './deepseekProvider.ts'
import { REFINE } from '../workflows/index.ts'
import type { WizardContext } from './wizardTypes.ts'

afterEach(() => vi.unstubAllGlobals())

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
