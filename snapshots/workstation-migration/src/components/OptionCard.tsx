import type { DirectionOption } from '../lib/wizardTypes.ts'

type Props = {
  option: DirectionOption
  selected: boolean
  onSelect: () => void
}

export default function OptionCard({ option, selected, onSelect }: Props) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={
        'block w-full rounded-xl border p-4 text-left transition-colors ' +
        (selected
          ? 'border-neutral-900 bg-neutral-50 dark:border-neutral-100 dark:bg-neutral-900'
          : 'border-neutral-200 hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600')
      }
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">{option.title}</h3>
        {option.recommended && (
          <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
            推荐
          </span>
        )}
      </div>

      <dl className="mt-3 space-y-2 text-xs leading-relaxed">
        <Row label="改什么" value={option.change} />
        <Row label="成像结果" value={option.outcome} />
        <Row label="代价与风险" value={option.risk} tone="warn" />
        <Row label="适配通道" value={option.channel} tone="muted" />
      </dl>
    </button>
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
    tone === 'warn'
      ? 'text-amber-700 dark:text-amber-400'
      : tone === 'muted'
        ? 'text-neutral-500 dark:text-neutral-400'
        : 'text-neutral-700 dark:text-neutral-300'
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-2">
      <dt className="text-neutral-400 dark:text-neutral-500">{label}</dt>
      <dd className={valueClass}>{value}</dd>
    </div>
  )
}
