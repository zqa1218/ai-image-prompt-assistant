import { create } from 'zustand'
import { estimateCost, type PriceTier } from './llm/cost.ts'
import { EMPTY_USAGE, type Usage } from './llm/types.ts'

export type SessionUsage = {
  calls: number
  usage: Usage
  costUsd: number
  lastTier: PriceTier | null
  lastCallAt: number | null
}

type UsageState = SessionUsage & {
  record: (usage: Usage) => void
  reset: () => void
}

const initial: SessionUsage = {
  calls: 0,
  usage: EMPTY_USAGE,
  costUsd: 0,
  lastTier: null,
  lastCallAt: null,
}

function plus(a: number, b: number): number {
  return a + b
}

export const useUsage = create<UsageState>()((set) => ({
  ...initial,

  record(incoming) {
    // 逐次按当次时段计价再累加：跨过高峰边界的会话不会被整体按单一价算
    const cost = estimateCost(incoming)
    set((state) => ({
      calls: state.calls + 1,
      costUsd: state.costUsd + cost.totalUsd,
      lastTier: cost.tier,
      lastCallAt: Date.now(),
      usage: {
        promptTokens: plus(state.usage.promptTokens, incoming.promptTokens),
        completionTokens: plus(state.usage.completionTokens, incoming.completionTokens),
        totalTokens: plus(state.usage.totalTokens, incoming.totalTokens),
        cacheHitTokens: plus(state.usage.cacheHitTokens, incoming.cacheHitTokens),
        cacheMissTokens: plus(state.usage.cacheMissTokens, incoming.cacheMissTokens),
        reasoningTokens: plus(state.usage.reasoningTokens, incoming.reasoningTokens),
      },
    }))
  },

  reset() {
    set({ ...initial })
  },
}))
