import type { WorkflowStage } from '../workflows/types.ts'
import type { StageRecord } from '../lib/wizardTypes.ts'

type Props = {
  stages: WorkflowStage[]
  current: number
  records: Record<string, StageRecord>
  onJump: (index: number) => void
}

/** 紧凑的编号步骤条：完成打勾，当前步骤用强调色，窄窗口自动换行。 */
export default function Stepper({ stages, current, records, onJump }: Props) {
  return (
    <ol className="flex flex-wrap items-center gap-1 text-xs">
      {stages.map((stage, index) => {
        const status = records[stage.id]?.status ?? 'idle'
        const isCurrent = index === current
        const canJump = index < current
        const badge =
          status === 'error'
            ? 'bg-red-500/20 text-red-300'
            : isCurrent
              ? 'bg-neutral-950/30 text-neutral-950'
              : status === 'ready'
                ? 'bg-emerald-500/15 text-emerald-300'
                : 'bg-neutral-800 text-neutral-400'
        return (
          <li key={stage.id}>
            <button
              type="button"
              disabled={!canJump}
              onClick={() => onJump(index)}
              aria-current={isCurrent ? 'step' : undefined}
              className={
                'flex min-h-8 items-center gap-1.5 rounded-full py-1 pl-1 pr-3 transition-colors ' +
                (isCurrent
                  ? 'bg-accent-500 font-semibold text-neutral-950'
                  : canJump
                    ? 'text-neutral-300 hover:bg-neutral-800'
                    : 'cursor-default text-neutral-500')
              }
            >
              <span
                className={
                  'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ' +
                  badge +
                  (status === 'running' ? ' animate-pulse' : '')
                }
              >
                {status === 'ready' && !isCurrent ? '✓' : index + 1}
              </span>
              {stage.title}
            </button>
          </li>
        )
      })}
    </ol>
  )
}
