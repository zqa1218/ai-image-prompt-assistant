import { describe, expect, it } from 'vitest'
import { parseSections, toMarkdown } from './promptSections.ts'

const FOUR_SECTION = `【保留项】严格保持人物身份与构图不变。
不要改变光向。

【修改项】在杯体与桌面接触区域增强真实感。

【禁止项】不要出现随机文字、水印。

【参数】比例 3:4，数量 1。`

describe('四段式解析', () => {
  it('按标记拆成四段', () => {
    const sections = parseSections(FOUR_SECTION)
    expect(sections?.map((s) => s.key)).toEqual(['保留项', '修改项', '禁止项', '参数'])
  })

  it('段落正文不含标记本身，且保留内部换行', () => {
    const sections = parseSections(FOUR_SECTION)
    expect(sections?.[0].body).toBe('严格保持人物身份与构图不变。\n不要改变光向。')
    expect(sections?.[0].body).not.toContain('【')
  })

  it('标记之前的引导文字单独成段', () => {
    const sections = parseSections(`以下是最终提示词：\n\n${FOUR_SECTION}`)
    expect(sections?.[0]).toEqual({ key: '说明', body: '以下是最终提示词：' })
    expect(sections?.[1].key).toBe('保留项')
  })

  it('标记数目不同也照样拆 —— 不写死四个名字', () => {
    const sections = parseSections('【正文】只有一段【补充】还有一段')
    expect(sections?.map((s) => s.key)).toEqual(['正文', '补充'])
  })

  it('解析不出两块以上时返回 null，交给调用方退回整段渲染', () => {
    expect(parseSections('就是一段没有任何标记的普通文本')).toBeNull()
    expect(parseSections('只出现一个【标记】而已')).toBeNull()
    expect(parseSections('')).toBeNull()
  })

  it('标记名里带换行不会被误判', () => {
    expect(parseSections('【保留\n项】内容【禁止项】内容')).toBeNull()
  })
})

describe('导出 Markdown', () => {
  it('标记变成小标题', () => {
    const md = toMarkdown(parseSections(FOUR_SECTION) ?? [])
    expect(md).toContain('### 保留项')
    expect(md).toContain('### 参数')
    expect(md).not.toContain('【')
  })
})
