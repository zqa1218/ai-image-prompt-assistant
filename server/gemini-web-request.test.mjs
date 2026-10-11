import { describe, expect, it } from 'vitest'
import { compileGeminiWebRequest } from './gemini-web-request.mjs'

describe('Gemini 网页请求包', () => {
  it('参考图单独提取时不会被错误命名成底图', () => {
    const result = compileGeminiWebRequest([{ role: 'user', content: [
      { type: 'text', text: '## 图片附件：REFERENCE_1（参考图1）' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AA' } },
    ] }])
    expect(result.images[0].name).toBe('REFERENCE_1_参考图.jpg')
  })
  it('合并规则与任务，并保持底图/参考图顺序', () => {
    const result = compileGeminiWebRequest([
      { role: 'system', content: '只输出 JSON' },
      {
        role: 'user',
        content: [
          { type: 'text', text: '生成修图提示词' },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA' } },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,BB' } },
        ],
      },
    ])

    expect(result.prompt).toContain('# 固定规则\n只输出 JSON')
    expect(result.prompt).toContain('# 本轮任务\n生成修图提示词')
    expect(result.images.map((image) => image.name)).toEqual([
      'REFERENCE_0_底图.jpg',
      'REFERENCE_1_参考图.jpg',
    ])
  })
})
