import { REFERENCE_CATEGORIES, type ReferenceItem } from '../lib/wizardTypes.ts'

type Props = {
  running: boolean
  text: string
  error?: string
  referenceItems: ReferenceItem[]
  selectedIds: string[]
  onToggleItem: (id: string) => void
  onRerun: () => void
}

export default function AnalyzeStage({
  running,
  text,
  error,
  referenceItems,
  selectedIds,
  onToggleItem,
  onRerun,
}: Props) {
  if (running) {
    return (
      <p className="animate-pulse rounded-xl border border-neutral-200 px-4 py-6 text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        {referenceItems.length > 0 ? '正在拆解原图与参考图…' : '正在按九维事实层拆解原图…'}
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
          重新分析
        </button>
      </div>
    )
  }

  const groups = REFERENCE_CATEGORIES.map((category) => ({
    category,
    items: referenceItems.filter((item) => item.category === category),
  })).filter((group) => group.items.length > 0)

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <pre className="text-xs leading-relaxed whitespace-pre-wrap">{text}</pre>
      </div>

      {groups.length > 0 && (
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">
              参考图可导入内容
              <span className="ml-2 text-xs font-normal text-neutral-400">
                勾选要迁移到原图的成分，不勾就不引入
              </span>
            </h3>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              已选 {selectedIds.length} / {referenceItems.length} 项。只迁移勾选的内容，
              原图的主体、身份与构图保持不变。
            </p>
          </div>

          {groups.map((group) => (
            <div key={group.category} className="space-y-2">
              <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                {group.category}
              </p>
              <ul className="space-y-1.5">
                {group.items.map((item) => {
                  const checked = selectedIds.includes(item.id)
                  return (
                    <li key={item.id}>
                      <label
                        className={
                          'flex cursor-pointer items-start gap-3 rounded-lg border p-2.5 transition-colors ' +
                          (checked
                            ? 'border-neutral-900 bg-neutral-50 dark:border-neutral-100 dark:bg-neutral-900'
                            : 'border-neutral-200 hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600')
                        }
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleItem(item.id)}
                          className="mt-0.5"
                        />
                        <span className="min-w-0 space-y-0.5">
                          <span className="flex items-baseline gap-2 text-xs font-medium">
                            {item.label}
                            <span className="font-normal text-neutral-400">{item.source}</span>
                          </span>
                          <span className="block text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                            {item.description}
                          </span>
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </section>
      )}

      <button type="button" onClick={onRerun} className={secondaryBtn}>
        重新分析
      </button>
    </div>
  )
}

const secondaryBtn =
  'rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
