export type PromptSection = {
  /** 标记名，如「保留项」 */
  key: string
  /** 标记之前的引导文字，没有则空 */
  body: string
}

const MARKER = /【([^】\n]{1,16})】/g

/**
 * 把四段式提示词拆成带标记的分段，用于分块渲染与逐段复制。
 *
 * 刻意做得宽松：不写死四个标记名，任何 `【…】` 标记都认。
 * 模型偶尔会多写或少写一段，硬校验四个名字只会让排版莫名其妙地退回纯文本。
 * 解析不出两块以上时返回 null，由调用方退回整段渲染。
 */
export function parseSections(text: string): PromptSection[] | null {
  const matches = [...text.matchAll(MARKER)]
  if (matches.length < 2) return null

  const sections: PromptSection[] = []

  const lead = text.slice(0, matches[0].index ?? 0).trim()
  if (lead) sections.push({ key: '说明', body: lead })

  matches.forEach((match, index) => {
    const start = (match.index ?? 0) + match[0].length
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? text.length) : text.length
    sections.push({ key: match[1], body: text.slice(start, end).trim() })
  })

  return sections
}

/** 导出成 Markdown 时把标记还原成小标题，便于阅读。 */
export function toMarkdown(sections: PromptSection[]): string {
  return sections.map((section) => `### ${section.key}\n\n${section.body}`).join('\n\n')
}
