/** 上游返回的 usage 归一化结果。字段可能缺失，缺失时按 0 处理。 */
export type Usage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cacheHitTokens: number
  cacheMissTokens: number
  reasoningTokens: number
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'original' | 'auto' } }

export type LlmMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | ContentPart[]
}

export type ThinkingMode = 'disabled' | 'enabled'

export type ChatOptions = {
  messages: LlmMessage[]
  /** 思考模式：默认关闭，只有方向建议与最终组装才开 */
  thinking: ThinkingMode
  /** 仅 thinking=enabled 时生效 */
  effort?: 'low' | 'high' | 'max'
  /** 要求返回 JSON 对象 */
  json?: boolean
  maxTokens?: number
  /** 仅非思考模式下发送；思考模式会忽略它 */
  temperature?: number
}

export type ChatResult = {
  content: string
  reasoning: string
  usage: Usage
  /** 实际发出的请求体，便于测试与排错 */
  requestBody: Record<string, unknown>
}

export const EMPTY_USAGE: Usage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  cacheHitTokens: 0,
  cacheMissTokens: 0,
  reasoningTokens: 0,
}

/** 把上游 usage 转成内部结构，兼容字段缺失与嵌套。 */
export function normalizeUsage(raw: unknown): Usage {
  const u = (raw ?? {}) as Record<string, unknown>
  const num = (value: unknown): number => (typeof value === 'number' ? value : 0)
  const details = (u['completion_tokens_details'] ?? {}) as Record<string, unknown>
  const promptTokens = num(u['prompt_tokens'])
  const cacheHit = num(u['prompt_cache_hit_tokens'])
  const cacheMiss = num(u['prompt_cache_miss_tokens'])

  return {
    promptTokens,
    completionTokens: num(u['completion_tokens']),
    totalTokens: num(u['total_tokens']) || promptTokens + num(u['completion_tokens']),
    cacheHitTokens: cacheHit,
    // 上游没给命中拆分时，把全部输入算作未命中，估价偏保守
    cacheMissTokens: cacheMiss || (cacheHit === 0 ? promptTokens : 0),
    reasoningTokens: num(details['reasoning_tokens']),
  }
}
