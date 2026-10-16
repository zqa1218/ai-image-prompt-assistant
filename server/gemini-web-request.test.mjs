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

  /** Gemini 4 会把「带图 + 修图字样」当成改图指令，直接开始生成图片。 */
  it('开头和结尾都声明只要文字，并说明修图字样不是改图指令', () => {
    const { prompt } = compileGeminiWebRequest([
      { role: 'user', content: [{ type: 'text', text: '把参考图里的元素迁移到底图' }] },
    ])
    expect(prompt).toContain('【纯文字任务 · 禁止生成图片】')
    expect(prompt).toContain('不是让你动手改图')
    expect(prompt).toContain('再次确认（最高优先级）')
    expect(prompt.trimEnd().endsWith('改用文字回答上面的任务。')).toBe(true)
    // 约束必须在正文之前，否则模型先读到“修图”就会开始做图
    expect(prompt.indexOf('禁止生成图片')).toBeLessThan(prompt.indexOf('# 本轮任务'))
  })
})
