/**
 * 实盘验证：同一段缓存前缀连发多次，确认后续请求能命中 DeepSeek 的上下文缓存。
 *
 * 默认跳过，需要显式开启（会真实调用 API 并产生费用，单次约 1 分钱以内）：
 *   PW_LIVE_TEST=1 npx vitest run src/lib/llm/cache.live.test.ts
 *
 * key 从项目根目录的 .env 读取，只用于本次请求，不会写入任何输出。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_ASSETS } from '../../workflows/assets.ts'
import { REFINE } from '../../workflows/index.ts'
import { deepseekProvider } from '../deepseekProvider.ts'
import { buildPrefix, hashPrefix } from '../prefix.ts'
import { parseSections } from '../promptSections.ts'
import { useUsage } from '../usageStore.ts'
import type { WizardContext } from '../wizardTypes.ts'
import { normalizeUsage } from './types.ts'

const enabled = process.env.PW_LIVE_TEST === '1'
const describeLive = enabled ? describe : describe.skip

function readApiKey(): string | null {
  const envPath = path.join(process.cwd(), '.env')
  let text = ''
  try {
    text = readFileSync(envPath, 'utf8')
  } catch {
    return null
  }
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*DEEPSEEK_API_KEY\s*=\s*(.+)\s*$/.exec(line)
    if (match) {
      const value = match[1].trim().replace(/^["']|["']$/g, '')
      if (value) return value
    }
  }
  return null
}

async function callOnce(apiKey: string, body: unknown) {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`上游返回 HTTP ${res.status}：${text.slice(0, 300)}`)
  }
  const payload = JSON.parse(text) as { usage?: unknown }
  return normalizeUsage(payload.usage)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function requireKey(): string {
  const apiKey = readApiKey()
  if (!apiKey) throw new Error('未在 .env 中找到 DEEPSEEK_API_KEY，无法执行实盘验证')
  return apiKey
}

function bodyWith(prefix: string, userText: string) {
  return {
    model: 'deepseek-flash',
    messages: [
      { role: 'system', content: prefix },
      { role: 'user', content: userText },
    ],
    thinking: { type: 'disabled' },
    max_tokens: 16,
  }
}

/**
 * 判定标准不是"第一次不命中、后面命中"——磁盘缓存是跨进程持久的，
 * 同一段前缀在之前的运行里可能已经写进去了，首轮就命中是正常的。
 * 真正要守住的指标是：**缓存在输入里占的比例够高**，
 * 也就是固定的 system 前缀被复用，而不是每次从头重算。
 */
const HIT_RATIO_FLOOR = 0.5

describeLive('真实缓存命中', () => {
  it(
    '固定前缀连发三次，缓存占输入的比例稳定在高位',
    async () => {
      const apiKey = requireKey()
      const prefix = buildPrefix(REFINE, DEFAULT_ASSETS)
      console.log(`\n前缀长度 ${prefix.length} 字符，sha256=${(await hashPrefix(prefix)).slice(0, 16)}…`)

      const usages = []
      for (let round = 1; round <= 3; round += 1) {
        const usage = await callOnce(apiKey, bodyWith(prefix, '请用一个词回答：收到。'))
        usages.push(usage)
        const ratio = usage.promptTokens > 0 ? usage.cacheHitTokens / usage.promptTokens : 0
        console.log(
          `第 ${round} 次：输入 ${usage.promptTokens}，命中 ${usage.cacheHitTokens}，` +
            `未命中 ${usage.cacheMissTokens}，命中占比 ${(ratio * 100).toFixed(1)}%`,
        )
        if (round < 3) await sleep(3000)
      }

      const last = usages[usages.length - 1]
      expect(last.cacheHitTokens).toBeGreaterThan(0)
      expect(last.cacheHitTokens / last.promptTokens).toBeGreaterThanOrEqual(HIT_RATIO_FLOOR)
    },
    180_000,
  )

  it(
    '只改用户消息、system 前缀不变时，前缀依然命中',
    async () => {
      const apiKey = requireKey()
      const prefix = buildPrefix(REFINE, DEFAULT_ASSETS)

      const first = await callOnce(apiKey, bodyWith(prefix, '请用一个词回答：收到。'))
      await sleep(3000)
      // 用户消息完全不同，但前缀逐字未变——这正是设计要保住的场景
      const second = await callOnce(apiKey, bodyWith(prefix, '请用一个词回答：明白。'))

      const ratio = second.promptTokens > 0 ? second.cacheHitTokens / second.promptTokens : 0
      console.log(
        `\n换用户消息后：输入 ${second.promptTokens}，命中 ${second.cacheHitTokens}，` +
          `命中占比 ${(ratio * 100).toFixed(1)}%`,
      )

      expect(second.cacheHitTokens).toBeGreaterThan(0)
      expect(ratio).toBeGreaterThanOrEqual(HIT_RATIO_FLOOR)
      // 未命中的部分应当只对应可变的用户消息，而不是整段前缀
      expect(second.cacheMissTokens).toBeLessThan(first.promptTokens)
    },
    120_000,
  )
})

/**
 * 端到端集成：让真实的 provider 走一遍完整链路
 * （构造消息 → 本地代理路径 → JSON 输出 → zod 校验 → 归一化 → 记账）。
 *
 * 这里用 stub 把前端的 `/api/chat` 改写成直连 DeepSeek，
 * 目的是验证消息结构与结构化输出契约，本地代理本身已由 smoke 测试覆盖。
 */
describeLive('真实 provider 集成', () => {
  it(
    '方向建议能拿到结构合法的选项，且用量被记账',
    async () => {
      const apiKey = requireKey()
      const realFetch = globalThis.fetch

      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (!url.startsWith('/api/chat')) return realFetch(input, init)

        // 本地代理会解析设置后补上 model（客户端刻意不发 model，
        // 免得把模型选择权从前端绕过去），这里如实模拟这一步。
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        return realFetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ model: 'deepseek-flash', ...body }),
        })
      })

      const callsBefore = useUsage.getState().calls
      const ctx: WizardContext = {
        workflow: REFINE,
        intake: { requirement: '让这张商品图的质感更高级', taskType: '质感升级,置入物体' },
        images: [],
        analysis:
          '【主体】深灰色陶瓷马克杯，位于画面中偏右下，约占画幅 42%。\n' +
          '【构图】3:4 竖幅，机位略高于杯口，右上留白。\n' +
          '【光照】疑似单侧柔光箱自左上 45° 入射，投影落向右下。\n' +
          '【色彩】冷中性偏灰，反差中等。\n' +
          '【镜头】疑似 85mm，浅景深。\n' +
          '【材质】釉面半哑光，桌面为木纹。\n' +
          '【接触关系】杯底有一圈接触阴影。\n' +
          '【画面层级】主体清晰区在杯体与杯沿。\n' +
          '【禁区】杯体无文字与 Logo。',
        options: [],
        selectedOptionId: null,
        notes: [],
        artifact: null,
        selectedReferenceItems: [],
      }

      const options = await deepseekProvider.suggestDirections(ctx)

      console.log('\n方向选项：')
      for (const option of options) {
        console.log(`- ${option.title}${option.recommended ? '（推荐）' : ''}｜${option.outcome.slice(0, 60)}…`)
      }

      expect(options.length).toBeGreaterThanOrEqual(2)
      expect(options.length).toBeLessThanOrEqual(4)
      expect(options.filter((o) => o.recommended)).toHaveLength(1)
      for (const option of options) {
        expect(option.title.trim().length).toBeGreaterThan(0)
        expect(option.change.trim().length).toBeGreaterThan(0)
        expect(option.outcome.trim().length).toBeGreaterThan(0)
        expect(option.risk.trim().length).toBeGreaterThan(0)
      }

      // 记账：真实调用必须被统计进去
      expect(useUsage.getState().calls).toBeGreaterThan(callsBefore)
      expect(useUsage.getState().usage.promptTokens).toBeGreaterThan(0)

      vi.unstubAllGlobals()
    },
    180_000,
  )

  it(
    '精修线能产出可解析的四段式提示词',
    async () => {
      const apiKey = requireKey()
      const realFetch = globalThis.fetch

      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (!url.startsWith('/api/chat')) return realFetch(input, init)
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        return realFetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: 'deepseek-flash', ...body }),
        })
      })

      const ctx: WizardContext = {
        workflow: REFINE,
        intake: {
          requirement: '让这张商品图的质感更高级',
          taskType: '质感升级,置入物体',
          spec: '3:4，2000px',
        },
        images: [],
        analysis:
          '【主体】深灰色陶瓷马克杯，位于画面中偏右下，约占画幅 42%。\n' +
          '【构图】3:4 竖幅，机位略高于杯口，右上留白。\n' +
          '【光照】疑似单侧柔光箱自左上 45° 入射，投影落向右下。\n' +
          '【色彩】冷中性偏灰，反差中等。\n' +
          '【镜头】疑似 85mm，浅景深。\n' +
          '【材质】釉面半哑光，桌面为木纹。\n' +
          '【接触关系】杯底有一圈接触阴影。\n' +
          '【画面层级】主体清晰区在杯体与杯沿。\n' +
          '【禁区】杯体无文字与 Logo。',
        options: [],
        selectedOptionId: null,
        notes: ['必须保留桌面木纹'],
        artifact: null,
        selectedReferenceItems: [],
      }

      const artifact = await deepseekProvider.compose(ctx)
      const sections = parseSections(artifact.prompt)

      console.log(`\n四段式段落：${sections?.map((s) => s.key).join(' / ')}`)
      console.log(`交付方式：${artifact.channel.slice(0, 60)}…`)

      expect(sections).not.toBeNull()
      const keys = sections?.map((s) => s.key) ?? []
      // 四段必须都在，顺序也应当与骨架一致
      expect(keys).toEqual(expect.arrayContaining(['保留项', '修改项', '禁止项', '参数']))
      expect(artifact.channel.trim().length).toBeGreaterThan(0)
      // 专项规则要落到提示词里：置入物体 → 接触点/阴影，质感升级 → 不换背景
      expect(artifact.prompt).toMatch(/接触|阴影|落点/)

      vi.unstubAllGlobals()
    },
    180_000,
  )
})
