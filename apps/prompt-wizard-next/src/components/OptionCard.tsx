import type { DirectionOption } from '../lib/wizardTypes.ts'

type Props = {
  option: DirectionOption
  selected: boolean
  onSelect: () => void
}

/** 方向建议：紧凑的单选行。一行看结果，“详情”里再看改什么、风险与通道。 */
export default function OptionCard({ option, selected, onSelect }: Props) {
  return (
    <div
      className={
        'rounded-lg px-3 py-2.5 transition-colors ' +
        (selected ? 'bg-accent-500/10 ring-1 ring-accent-500/50' : 'hover:bg-neutral-900')
      }
    >
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="radio"
          name="direction-option"
          checked={selected}
          onChange={onSelect}
          className="mt-1 h-4 w-4 shrink-0 accent-accent-500"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-sm font-semibold text-neutral-100">{option.title}</span>
            {option.recommended && (
              <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                推荐
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-xs leading-relaxed text-neutral-400">{option.outcome}</span>
        </span>
      </label>
      <details className="ml-7 mt-1">
        <summary className="cursor-pointer select-none text-xs text-neutral-500 hover:text-neutral-300">详情</summary>
        <dl className="mt-2 space-y-1.5 text-xs leading-relaxed">
          <Row label="改什么" value={option.change} />
          <Row label="代价与风险" value={option.risk} tone="warn" />
          <Row label="适配通道" value={option.channel} tone="muted" />
        </dl>
      </details>
    </div>
  )
}

function Row({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'warn' | 'muted'
}) {
  const valueClass =
    tone === 'warn' ? 'text-amber-300' : tone === 'muted' ? 'text-neutral-400' : 'text-neutral-200'
  return (
    <div className="grid grid-cols-[5rem_1fr] gap-2">
      <dt className="text-neutral-500">{label}</dt>
      <dd className={valueClass}>{value}</dd>
    </div>
  )
}
