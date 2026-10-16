/**
 * 剥掉模型在提示词末尾追加的“操作建议”和客套话。
 *
 * 网页端（Gemini）经常在正文最后补一句「建议使用 Gemini 的 Nano Banana 模型进行…」，
 * 这句话会被一起复制进绘图工具，用户明确反馈不要它。
 *
 * 规则刻意收得很紧，避免误删正文：
 * - 只从结尾往回剥，命中第一行“不是建议”的就停；
 * - 最多剥 3 行，且剥完必须还剩足够正文；
 * - 只认建议类开头、工具推荐、收尾客套这三类措辞。
 */
const ADVICE_LEAD =
  /^(建议|推荐|不妨|如需|若需|如果需要|有需要|提示|小提示|备注|以上|希望|祝|另外|最后)/u
const TOOL_NAME =
  /(Nano\s?Banana|Gemini|Midjourney|MJ|即梦|可灵|Stable\s?Diffusion|GPT-?Image|DALL[·\-]?E|豆包|文心|SDXL?)/iu
const ASK_MORE = /(告诉我|可以继续|随时联系|欢迎随时|再帮你|方便的话|希望对你)/u

/** 带这些词的结尾行是提示词本身（「最后检查：确认没有换脸」），不是模型附赠的建议。 */
const PROMPT_DIRECTIVE = /(禁止|不要|不得|必须|保持|保留|确认|避免|锁定|严禁)/u

/** 句末建议常常和正文挤在同一行，用句子边界切分后单独判断。 */
const SENTENCE_BOUNDARY = /(?:^|[。！？；;!?])\s*/gu

const MAX_TRAILING_LINES = 3
const MIN_KEPT_CHARS = 24

function isAdviceLine(line: string): boolean {
  const value = line.trim()
  if (!value) return false
  // 【某某】这种分段标记属于提示词结构，任何情况下都不是建议行。
  if (/^【[^】]{1,16}】/u.test(value)) return false
  if (PROMPT_DIRECTIVE.test(value)) return false
  if (ADVICE_LEAD.test(value)) return true
  if (ASK_MORE.test(value)) return true
  return TOOL_NAME.test(value) && /(使用|调用|生成|出图|编辑|修图|制作|提交)/u.test(value)
}

/**
 * 行内切尾巴。只认「推荐某个工具」和「收尾客套」这两类，
 * 不认「建议 / 最后」这类开头——正文里的「最后检查：确认没有换脸」是提示词本身，
 * 一旦按行首建议词切掉就成了脏数据。
 */
function stripInlineAdvice(line: string): string {
  let cut = -1
  for (const match of line.matchAll(SENTENCE_BOUNDARY)) {
    const start = match.index + match[0].length
    const sentence = line.slice(start).trim()
    if (!sentence) continue
    const toolAdvice = TOOL_NAME.test(sentence) && /(使用|调用|生成|出图|编辑|修图|制作|提交)/u.test(sentence)
    if (toolAdvice || ASK_MORE.test(sentence)) cut = start
  }
  return cut > 0 ? line.slice(0, cut).replace(/\s+$/u, '') : line
}

/**
 * 只清理结尾。中间的「建议」可能是提示词正文里真正要写进去的内容，不动它。
 */
export function stripTrailingAdvice(text: string): string {
  const original = String(text ?? '')
  if (!original.trim()) return original

  const lines = original.split('\n')
  let lastContent = -1
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim()) { lastContent = index; break }
  }
  let inlineChanged = false
  if (lastContent >= 0) {
    const next = stripInlineAdvice(lines[lastContent])
    if (next !== lines[lastContent]) { lines[lastContent] = next; inlineChanged = true }
  }
  let end = lines.length
  let removed = 0

  while (end > 0 && removed < MAX_TRAILING_LINES) {
    const index = end - 1
    const line = lines[index].trim()
    if (!line) {
      end -= 1
      continue
    }
    if (!isAdviceLine(line)) break
    end -= 1
    removed += 1
  }

  if (removed === 0 && !inlineChanged) return original

  const kept = lines.slice(0, end).join('\n').replace(/\s+$/u, '')
  // 剥完不像提示词了就保持原样，宁可留着建议也不能把正文删空。
  if (kept.trim().length < MIN_KEPT_CHARS) return original
  return kept
}
