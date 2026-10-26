import OptionCard from '../components/OptionCard.tsx'
import type { DirectionOption } from '../lib/wizardTypes.ts'

type Props = {
  running: boolean
  options: DirectionOption[]
  selectedId: string | null
  error?: string
  onSelect: (id: string) => void
  onRerun: () => void
}

export default function DirectionStage({
  running,
  options,
  selectedId,
  error,
  onSelect,
  onRerun,
}: Props) {
  if (running) {
    return (
      <p className="animate-pulse rounded-xl border border-neutral-200 px-4 py-6 text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        正在生成方向建议…
      </p>
    )
  }

  if (error) {
    return (
      <div className="space-y-3">
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
        <button type="button" onClick={onRerun} className={secondaryBtn}>
          重新生成方向
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        选一个方向继续。不选直接点下一步，会按推荐项走。
      </p>
      <div className="space-y-3">
        {options.map((option) => (
          <OptionCard
            key={option.id}
            option={option}
            selected={option.id === selectedId}
            onSelect={() => onSelect(option.id)}
          />
        ))}
      </div>
      <button type="button" onClick={onRerun} className={secondaryBtn}>
        重新生成方向
      </button>
    </div>
  )
}

const secondaryBtn =
  'rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
