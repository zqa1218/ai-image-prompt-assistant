import { describe, expect, it } from 'vitest'
import { estimateCost, isPeak, priceTier } from './cost.ts'
import { EMPTY_USAGE, normalizeUsage, type Usage } from './types.ts'

/** 2026-09-28 是周一，UTC 02:00 落在高峰窗口内。 */
const MONDAY_PEAK = new Date('2026-09-28T02:00:00Z')
const MONDAY_OFFPEAK = new Date('2026-09-28T12:00:00Z')
const SATURDAY = new Date('2026-09-26T02:00:00Z')

describe('峰谷时段', () => {
  it('工作日 UTC 01–04 与 06–10 是高峰', () => {
    expect(isPeak(new Date('2026-09-28T01:00:00Z'))).toBe(true)
    expect(isPeak(new Date('2026-09-28T03:59:00Z'))).toBe(true)
    expect(isPeak(new Date('2026-09-28T06:00:00Z'))).toBe(true)
    expect(isPeak(new Date('2026-09-28T09:59:00Z'))).toBe(true)
  })

  it('窗口边界是左闭右开', () => {
    expect(isPeak(new Date('2026-09-28T00:59:00Z'))).toBe(false)
    expect(isPeak(new Date('2026-09-28T04:00:00Z'))).toBe(false)
    expect(isPeak(new Date('2026-09-28T05:59:00Z'))).toBe(false)
    expect(isPeak(new Date('2026-09-28T10:00:00Z'))).toBe(false)
  })

  it('周末全天非高峰', () => {
    expect(isPeak(SATURDAY)).toBe(false)
    expect(priceTier(SATURDAY)).toBe('offPeak')
  })
})

describe('费用估算', () => {
  const usage: Usage = {
    ...EMPTY_USAGE,
    promptTokens: 20_000,
    cacheHitTokens: 19_000,
    cacheMissTokens: 1_000,
    completionTokens: 2_000,
  }

  it('非高峰价准确地按三类 token 分别计算', () => {
    const cost = estimateCost(usage, MONDAY_OFFPEAK)
    expect(cost.tier).toBe('offPeak')
    // 19000/1M*0.003 = 0.000057
    expect(cost.cacheHitUsd).toBeCloseTo(0.000057, 10)
    // 1000/1M*0.15 = 0.00015
    expect(cost.cacheMissUsd).toBeCloseTo(0.00015, 10)
    // 2000/1M*0.6 = 0.0012
    expect(cost.outputUsd).toBeCloseTo(0.0012, 10)
    expect(cost.totalUsd).toBeCloseTo(0.001407, 10)
  })

  it('高峰价正好是非高峰的两倍', () => {
    const peak = estimateCost(usage, MONDAY_PEAK)
    const off = estimateCost(usage, MONDAY_OFFPEAK)
    expect(peak.tier).toBe('peak')
    expect(peak.totalUsd).toBeCloseTo(off.totalUsd * 2, 10)
  })

  it('命中与未命中的价差是 50 倍（不能混算）', () => {
    const allHit = estimateCost(
      { ...EMPTY_USAGE, promptTokens: 10_000, cacheHitTokens: 10_000 },
      MONDAY_OFFPEAK,
    )
    const allMiss = estimateCost(
      { ...EMPTY_USAGE, promptTokens: 10_000, cacheMissTokens: 10_000 },
      MONDAY_OFFPEAK,
    )
    expect(allMiss.totalUsd / allHit.totalUsd).toBeCloseTo(50, 6)
  })
})

describe('usage 归一化', () => {
  it('读取缓存命中与未命中的拆分字段', () => {
    const usage = normalizeUsage({
      prompt_tokens: 1000,
      completion_tokens: 200,
      total_tokens: 1200,
      prompt_cache_hit_tokens: 800,
      prompt_cache_miss_tokens: 200,
    })
    expect(usage.cacheHitTokens).toBe(800)
    expect(usage.cacheMissTokens).toBe(200)
  })

  it('缺少命中字段时把全部输入算作未命中（估价偏保守）', () => {
    const usage = normalizeUsage({ prompt_tokens: 500, completion_tokens: 100 })
    expect(usage.cacheHitTokens).toBe(0)
    expect(usage.cacheMissTokens).toBe(500)
    expect(usage.totalTokens).toBe(600)
  })

  it('字段全缺时返回全零而不是 NaN', () => {
    expect(normalizeUsage(undefined)).toEqual(EMPTY_USAGE)
    expect(normalizeUsage({})).toEqual(EMPTY_USAGE)
  })
})
