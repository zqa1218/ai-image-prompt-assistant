import type { Usage } from './types.ts'

/** 每 1M token 的美元价（DeepSeek 官方定价页）。 */
export const PRICING = {
  peak: { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 },
  offPeak: { cacheHit: 0.003, cacheMiss: 0.15, output: 0.6 },
} as const

export type PriceTier = keyof typeof PRICING

const PER_TOKENS = 1_000_000

/**
 * 高峰时段：UTC 周一至周五 01:00–04:00 与 06:00–10:00。
 * 官方排除中国法定节假日，程序无法获知节假日表，所以节假日当天会高估。
 */
export function isPeak(at: Date): boolean {
  const day = at.getUTCDay() // 0=周日
  const hour = at.getUTCHours()
  const weekday = day >= 1 && day <= 5
  const inWindow = (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10)
  return weekday && inWindow
}

export function priceTier(at: Date): PriceTier {
  return isPeak(at) ? 'peak' : 'offPeak'
}

export type CostBreakdown = {
  tier: PriceTier
  cacheHitUsd: number
  cacheMissUsd: number
  outputUsd: number
  totalUsd: number
}

/**
 * 命中与未命中的输入分开计价 —— 两者单价差 50 倍，
 * 混在一起算会让成本估算完全失真。
 */
export function estimateCost(usage: Usage, at: Date = new Date()): CostBreakdown {
  const tier = priceTier(at)
  const price = PRICING[tier]

  const cacheHitUsd = (usage.cacheHitTokens / PER_TOKENS) * price.cacheHit
  const cacheMissUsd = (usage.cacheMissTokens / PER_TOKENS) * price.cacheMiss
  const outputUsd = (usage.completionTokens / PER_TOKENS) * price.output

  return {
    tier,
    cacheHitUsd,
    cacheMissUsd,
    outputUsd,
    totalUsd: cacheHitUsd + cacheMissUsd + outputUsd,
  }
}

export function formatUsd(value: number): string {
  if (value === 0) return '$0'
  if (value < 0.01) return `$${value.toFixed(5)}`
  return `$${value.toFixed(4)}`
}
