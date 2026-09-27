import type { ZodType } from 'zod'
import { useUsage } from '../usageStore.ts'
import { normalizeUsage, type ChatOptions, type ChatResult } from './types.ts'

export class LlmError extends Error {
  status: number

  constructor(message: string, status = 0) {
    super(message)
    this.name = 'LlmError'
    this.status = status
  }
}

/**
 * 构造发给 DeepSeek 的请求体。
 *
 * 两条容易踩的规则：
 * - 思考模式默认开启，必须显式传 `thinking: { type: 'disabled' }` 才是关闭
 * - 思考模式下 temperature 完全无效，所以开启时干脆不发，避免造成"设了但没用"的误解
 */
export function buildRequestBody(opts: ChatOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    messages: opts.messages,
    stream: false,
    thinking: { type: opts.thinking },
  }

  if (opts.thinking === 'enabled') {
    body.reasoning_effort = opts.effort ?? 'low'
  } else if (opts.temperature !== undefined) {
    body.temperature = opts.temperature
  }

  if (opts.json) {
    body.response_format = { type: 'json_object' }
  }
  if (opts.maxTokens !== undefined) {
    body.max_tokens = opts.maxTokens
  }

  return body
}

/** 从可能被 ```json 包裹、或夹带解释文字的回复里取出 JSON。 */
export function extractJson(text: string): unknown | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const direct = tryParse(trimmed)
  if (direct !== undefined) return direct

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
  if (fenced) {
    const parsed = tryParse(fenced[1].trim())
    if (parsed !== undefined) return parsed
  }

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start !== -1 && end > start) {
    const parsed = tryParse(trimmed.slice(start, end + 1))
    if (parsed !== undefined) return parsed
  }

  return null
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export async function chat(opts: ChatOptions): Promise<ChatResult> {
  const body = buildRequestBody(opts)

  let res: Response
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new LlmError('无法连接本地代理，请确认 npm run dev 仍在运行')
  }

  const text = await res.text()
  const payload = (text ? tryParse(text) : undefined) as
    | { choices?: { message?: { content?: string; reasoning_content?: string } }[]; usage?: unknown; error?: { message?: string } }
    | undefined

  if (!res.ok) {
    throw new LlmError(payload?.error?.message ?? `请求失败（HTTP ${res.status}）`, res.status)
  }
  if (!payload) {
    throw new LlmError('上游返回的不是合法 JSON')
  }

  const message = payload.choices?.[0]?.message
  const usage = normalizeUsage(payload.usage)
  // 每一次真实调用都记账，避免某条分支漏记导致成本显示失真
  useUsage.getState().record(usage)

  return {
    content: message?.content ?? '',
    reasoning: message?.reasoning_content ?? '',
    usage,
    requestBody: body,
  }
}

export type StructuredOutcome<T> =
  | { ok: true; data: T; attempts: number }
  | { ok: false; raw: string; attempts: number; reason: string }

/**
 * 三级容错：JSON 校验失败 → 原样重试 → 再失败就交回原始文本，由调用方降级展示。
 * 官方文档承认 JSON Output 偶发返回空内容，所以这里必须容忍空字符串。
 */
export async function chatJson<T>(
  opts: ChatOptions,
  schema: ZodType<T>,
  retryHint: string = DEFAULT_RETRY_HINT,
): Promise<StructuredOutcome<T>> {
  let lastRaw = ''
  let lastReason = '未收到任何内容'

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const requestOpts = attempt === 1 ? opts : withRetryHint(opts, retryHint)
    const result = await chat({ ...requestOpts, json: true })
    lastRaw = result.content

    if (!result.content.trim()) {
      lastReason = '模型返回了空内容'
      continue
    }

    const parsed = extractJson(result.content)
    if (parsed === null) {
      lastReason = '返回内容不是合法 JSON'
      continue
    }

    const validated = schema.safeParse(parsed)
    if (!validated.success) {
      lastReason = `结构不符合预期：${validated.error.issues[0]?.message ?? '未知字段问题'}`
      continue
    }

    return { ok: true, data: validated.data, attempts: attempt }
  }

  return { ok: false, raw: lastRaw, attempts: 2, reason: lastReason }
}

/**
 * 重试时给一条不同的提示。
 *
 * 原样重发只在失败是偶发时有用；如果模型每次都把 JSON 包在解释文字里，
 * 原样重发必然重蹈覆辙。加一句话改变输入，才有第二次机会。
 */
function withRetryHint(opts: ChatOptions, hint: string): ChatOptions {
  return {
    ...opts,
    messages: [...opts.messages, { role: 'user', content: hint }],
  }
}

const DEFAULT_RETRY_HINT =
  '上一次的输出无法解析成要求的 json 结构。请只输出一个合法的 json 对象，' +
  '不要包含任何解释文字、前后缀或代码块标记。'
