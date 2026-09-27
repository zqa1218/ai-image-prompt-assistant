import { useEffect, useMemo, useState } from 'react'
import { ASSET_IDS, ASSET_SOURCES, DEFAULT_ASSETS } from '../workflows/assets.ts'
import { WORKFLOWS } from '../workflows/index.ts'
import { effectiveAssets, isOverridden, useAssetStore } from '../lib/assetStore.ts'
import { buildPrefix, hashPrefix, orderedAssetIds } from '../lib/prefix.ts'

export default function AssetsPage() {
  const overrides = useAssetStore((s) => s.overrides)
  const setOverride = useAssetStore((s) => s.setOverride)
  const resetAsset = useAssetStore((s) => s.resetAsset)
  const resetAll = useAssetStore((s) => s.resetAll)

  const [selectedId, setSelectedId] = useState(ASSET_IDS[0] ?? '')
  const [draft, setDraft] = useState('')
  const [hashes, setHashes] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)

  const assets = useMemo(() => effectiveAssets(overrides), [overrides])
  const current = assets[selectedId] ?? ''
  const dirty = draft !== current
  const overridden = isOverridden(overrides, selectedId)

  useEffect(() => {
    setDraft(assets[selectedId] ?? '')
    setSaved(false)
  }, [assets, selectedId])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const next: Record<string, string> = {}
      for (const workflow of WORKFLOWS) {
        next[workflow.id] = await hashPrefix(buildPrefix(workflow, assets))
      }
      if (!cancelled) setHashes(next)
    })()
    return () => {
      cancelled = true
    }
  }, [assets])

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-semibold">工作流资产</h2>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          这些资产会被拼进请求的固定前缀。前缀跨阶段逐字不变才能命中缓存，
          所以改动会让该工作流的历史缓存失效。
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
          缓存前缀哈希
        </h3>
        <div className="overflow-hidden rounded-lg border border-neutral-200 text-sm dark:border-neutral-800">
          {WORKFLOWS.map((workflow) => (
            <div
              key={workflow.id}
              className="flex items-baseline gap-3 border-b border-neutral-200 px-3 py-2 last:border-b-0 dark:border-neutral-800"
            >
              <span className="w-32 shrink-0 font-medium">{workflow.name}</span>
              <code className="truncate font-mono text-xs text-neutral-500 dark:text-neutral-400">
                {hashes[workflow.id] ?? '计算中…'}
              </code>
            </div>
          ))}
        </div>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          顺序：全局指令 → 共享资产 → 专属资产。两条线共享前两段，所以能在共享段命中同一份缓存。
          {WORKFLOWS.map((w) => (
            <span key={w.id}>
              {' '}
              {w.id}: {orderedAssetIds(w).join(' → ')}
            </span>
          ))}
        </p>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap gap-1">
          {ASSET_IDS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setSelectedId(id)}
              className={
                'rounded-md px-3 py-1.5 text-xs transition-colors ' +
                (id === selectedId
                  ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                  : 'border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800')
              }
            >
              {id}
              {isOverridden(overrides, id) && <span className="ml-1 text-amber-500">●</span>}
            </button>
          ))}
        </div>

        <div className="flex items-baseline justify-between gap-4">
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            来源：{ASSET_SOURCES[selectedId] ?? '未知'}
            {overridden && <span className="ml-2 text-amber-600 dark:text-amber-400">已覆盖默认值</span>}
          </div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            {draft.length} 字符（默认 {DEFAULT_ASSETS[selectedId]?.length ?? 0}）
            {dirty && <span className="ml-2 text-amber-600 dark:text-amber-400">未保存</span>}
            {saved && !dirty && <span className="ml-2 text-emerald-600 dark:text-emerald-400">已保存</span>}
          </div>
        </div>

        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setSaved(false)
          }}
          spellCheck={false}
          className="h-96 w-full resize-y rounded-lg border border-neutral-300 bg-white p-3 font-mono text-xs leading-relaxed outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
        />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!dirty}
            onClick={() => {
              setOverride(selectedId, draft)
              setSaved(true)
            }}
            className={primaryBtn + (dirty ? '' : ' opacity-40')}
          >
            保存修改
          </button>
          <button
            type="button"
            disabled={!overridden && !dirty}
            onClick={() => {
              resetAsset(selectedId)
              setDraft(DEFAULT_ASSETS[selectedId] ?? '')
              setSaved(false)
            }}
            className={secondaryBtn + (overridden || dirty ? '' : ' opacity-40')}
          >
            恢复本份默认值
          </button>
          <button type="button" onClick={resetAll} className={secondaryBtn}>
            全部恢复默认
          </button>
        </div>
      </section>
    </div>
  )
}

const primaryBtn =
  'rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 ' +
  'disabled:cursor-not-allowed dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white'

const secondaryBtn =
  'rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 ' +
  'disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800'
