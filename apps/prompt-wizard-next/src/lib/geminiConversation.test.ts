import { describe, expect, it } from 'vitest'
import { buildGeminiContent } from './geminiConversation.ts'
import type { WizardImage } from './wizardTypes.ts'

const image = (role: 'original' | 'reference', name: string): WizardImage => ({
  role,
  name,
  dataUrl: `data:image/jpeg;base64,${name}`,
  width: 100,
  height: 100,
  bytes: 10,
})

describe('Gemini 多模态对话包', () => {
  it('每张图片前都有不会错位的角色标签', () => {
    const parts = buildGeminiContent('任务', [
      image('original', 'base'),
      image('reference', 'ref-a'),
      image('reference', 'ref-b'),
    ])

    expect(parts.map((part) => part.type)).toEqual([
      'text', 'text', 'image_url', 'text', 'image_url', 'text', 'image_url', 'text',
    ])
    expect(parts[1]).toMatchObject({ type: 'text', text: expect.stringContaining('REFERENCE_0') })
    expect(parts[3]).toMatchObject({ type: 'text', text: expect.stringContaining('参考图1') })
    expect(parts[5]).toMatchObject({ type: 'text', text: expect.stringContaining('参考图2') })
  })

  it('没有图片时不伪造附件说明', () => {
    expect(buildGeminiContent('任务', [])).toEqual([{ type: 'text', text: '任务' }])
  })
})
