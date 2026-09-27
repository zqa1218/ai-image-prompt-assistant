import type { WorkflowStage } from '../workflows/types.ts'
import type { StageRecord } from '../lib/wizardTypes.ts'

type Props = {
  stages: WorkflowStage[]
  current: number
  records: Record<string, StageRecord>
  onJump: (index: number) => void
}

export default function Stepper({ stages, current, records, onJump }: Props) {
  return (
    <ol className="flex flex-wrap items-center gap-1 text-xs">
      {stages.map((stage, index) => {
        const status = records[stage.id]?.status ?? 'idle'
        const isCurrent = index === current
        const canJump = index < current
        return (
          <li key={stage.id} className="flex items-center gap-1">
            {index > 0 && <span className="text-neutral-300 dark:text-neutral-700">›</span>}
            <button
              type="button"
              disabled={!canJump}
              onClick={() => onJump(index)}
              aria-current={isCurrent ? 'step' : undefined}
              className={
                'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 transition-colors ' +
                (isCurrent
                  ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                  : canJump
                    ? 'text-neutral-600 hover:bg-neutral-200/60 dark:text-neutral-400 dark:hover:bg-neutral-800'
                    : 'cursor-default text-neutral-400 dark:text-neutral-600')
              }
            >
              <span
                className={
                  'inline-block h-1.5 w-1.5 rounded-full ' +
                  (status === 'ready'
                    ? 'bg-emerald-500'
                    : status === 'running'
                      ? 'animate-pulse bg-amber-500'
                      : status === 'error'
                        ? 'bg-red-500'
                        : 'bg-neutral-300 dark:bg-neutral-700')
                }
              />
              {stage.title}
            </button>
          </li>
        )
      })}
    </ol>
  )
}
