import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { buildRequestBody, chatJson, extractJson } from './client.ts'
import type { LlmMessage } from './types.ts'

const MESSAGES: LlmMessage[] = [{ role: 'user', content: 'hi' }]

function fetchOnce(content: string, status = 200) {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
      { status, headers: { 'content-type': 'application/json' } },
    ),
  )
}

function fetchSequence(contents: string[]) {
  let index = 0
  return vi.fn(async () => {
    const content = contents[Math.min(index++, contents.length - 1)]
    return new Response(
      JSON.stringify({ choices: [{ message: { content } }], usage: {} }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('请求体构造', () => {
  it('思考关闭：带 temperature，不带 reasoning_effort', () => {
    const body = buildRequestBody({
      messages: MESSAGES,
      thinking: 'disabled',
      temperature: 0.3,
    })
    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body.temperature).toBe(0.3)
    expect(body).not.toHaveProperty('reasoning_effort')
  })

  it('思考开启：带 reasoning_effort，不带 temperature（思考模式下它无效）', () => {
    const body = buildRequestBody({
      messages: MESSAGES,
      thinking: 'enabled',
      effort: 'low',
      temperature: 0.3,
    })
    expect(body.thinking).toEqual({ type: 'enabled' })
    expect(body.reasoning_effort).toBe('low')
    expect(body).not.toHaveProperty('temperature')
  })

  it('开启 JSON 模式时带 response_format', () => {
    const body = buildRequestBody({
      messages: MESSAGES,
      thinking: 'disabled',
      json: true,
      maxTokens: 2048,
    })
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.max_tokens).toBe(2048)
    expect(body.stream).toBe(false)
  })
})

describe('JSON 提取', () => {
  it('直接可解析', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('能从 ```json 代码块里取出', () => {
    expect(extractJson('这是结果：\n```json\n{"a":1}\n```\n以上')).toEqual({ a: 1 })
  })

  it('能从夹带说明文字的输出里取出', () => {
    expect(extractJson('好的，结果如下 {"a":1} 希望有帮助')).toEqual({ a: 1 })
  })

  it('完全不是 JSON 时返回 null', () => {
    expect(extractJson('就是一段普通文字')).toBeNull()
    expect(extractJson('')).toBeNull()
  })
})

describe('三级容错', () => {
  const schema = z.object({ options: z.array(z.object({ title: z.string() })).min(2) })

  it('第一次就合法时不重试', async () => {
    const fetchMock = fetchOnce('{"options":[{"title":"A"},{"title":"B"}]}')
    vi.stubGlobal('fetch', fetchMock)

    const result = await chatJson({ messages: MESSAGES, thinking: 'disabled' }, schema)
    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('第一次结构不合预期，第二次修复后成功', async () => {
    const fetchMock = fetchSequence(['{"options":[{"title":"A"}]}', '{"options":[{"title":"A"},{"title":"B"}]}'])
    vi.stubGlobal('fetch', fetchMock)

    const result = await chatJson({ messages: MESSAGES, thinking: 'disabled' }, schema)
    expect(result.ok).toBe(true)
    expect(result.attempts).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('两次都是空内容时降级，并把原始文本交回调用方', async () => {
    vi.stubGlobal('fetch', fetchSequence(['', '   ']))

    const result = await chatJson({ messages: MESSAGES, thinking: 'disabled' }, schema)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('空内容')
    }
  })

  it('两次都无法解析成结构化数据时降级，但保留原始输出', async () => {
    vi.stubGlobal('fetch', fetchSequence(['完全不是 JSON 的一段话', '依然是文字']))

    const result = await chatJson({ messages: MESSAGES, thinking: 'disabled' }, schema)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.raw).toBe('依然是文字')
      expect(result.attempts).toBe(2)
    }
  })

  it('重试时会给一条不同的提示，而不是原样重发', async () => {
    const bodies: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        bodies.push(String(init?.body ?? ''))
        const content =
          bodies.length === 1 ? '这不是 JSON' : '{"options":[{"title":"A"},{"title":"B"}]}'
        return new Response(
          JSON.stringify({ choices: [{ message: { content } }], usage: {} }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }),
    )

    const result = await chatJson(
      { messages: MESSAGES, thinking: 'disabled' },
      schema,
      '请只输出 json',
    )

    expect(result.ok).toBe(true)
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).not.toContain('请只输出 json')
    expect(bodies[1]).toContain('请只输出 json')
  })

  it('默认提示里明确要求只输出 json 对象', async () => {
    const bodies: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        bodies.push(String(init?.body ?? ''))
        return new Response(
          JSON.stringify({ choices: [{ message: { content: '还是不对' } }], usage: {} }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }),
    )

    await chatJson({ messages: MESSAGES, thinking: 'disabled' }, schema)
    expect(bodies[1]).toContain('json')
  })
})
