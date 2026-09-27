import { formatUsd } from '../lib/llm/cost.ts'
import { useUsage } from '../lib/usageStore.ts'

function formatTokens(value: number): string {
  if (value === 0) return '0'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

export default function UsageBar() {
  const calls = useUsage((s) => s.calls)
  const usage = useUsage((s) => s.usage)
  const costUsd = useUsage((s) => s.costUsd)
  const lastTier = useUsage((s) => s.lastTier)

  if (calls === 0) return null

  const hitRate =
    usage.promptTokens > 0 ? Math.round((usage.cacheHitTokens / usage.promptTokens) * 100) : 0

  return (
    <p className="text-xs text-neutral-500 dark:text-neutral-400">
      本次会话 {calls} 次调用 · 输入 {formatTokens(usage.promptTokens)}（缓存命中{' '}
      {formatTokens(usage.cacheHitTokens)}，{hitRate}%）· 输出{' '}
      {formatTokens(usage.completionTokens)} · 预估 {formatUsd(costUsd)}
      {lastTier === 'peak' ? '（高峰价）' : '（非高峰价）'}
    </p>
  )
}
