import { useEffect, useMemo, useState } from 'react'
import { getPoseIndex, getPoseMeta, poseImageUrl, type PoseIndex, type PoseItem, type PoseMeta } from '../lib/api.ts'
import { loadImageFile, normalizeForUpload } from '../lib/image.ts'
import { useWizard } from '../lib/wizardStore.ts'

const PAGE_SIZE = 60

export default function PosePage({ openWizard }: { openWizard: () => void }) {
  const [meta, setMeta] = useState<PoseMeta | null>(null)
  const [index, setIndex] = useState<PoseIndex | null>(null)
  const [includeAdult, setIncludeAdult] = useState(false)
  const [query, setQuery] = useState('')
  const [l1, setL1] = useState('')
  const [l2, setL2] = useState('')
  const [l3, setL3] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    void getPoseMeta().then(setMeta).catch((error) => setNotice(describe(error)))
  }, [])

  useEffect(() => {
    let alive = true
    setNotice('')
    setSelected([])
    setLimit(PAGE_SIZE)
    void getPoseIndex(includeAdult)
      .then((value) => { if (alive) setIndex(value) })
      .catch((error) => { if (alive) setNotice(describe(error)) })
    return () => { alive = false }
  }, [includeAdult])

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('zh-CN')
    return (index?.items ?? []).filter((item) => {
      if (l1 && item.l1 !== l1) return false
      if (l2 && item.l2 !== l2) return false
      if (l3 && item.l3 !== l3) return false
      if (!needle) return true
      return [item.name, item.id, item.group, item.l1, item.l2, item.l3, item.kw, ...item.tags, ...item.derived]
        .join(' ')
        .toLocaleLowerCase('zh-CN')
        .includes(needle)
    })
  }, [index, query, l1, l2, l3])

  function toggle(id: string) {
    setSelected((current) => current.includes(id)
      ? current.filter((value) => value !== id)
      : current.length < 4 ? [...current, id] : current)
  }

  async function importSelected() {
    if (!index || !selected.length) return
    setBusy(true)
    setNotice('')
    try {
      const items = selected.map((id) => index.items.find((item) => item.id === id)).filter(Boolean) as PoseItem[]
      const images = []
      for (const item of items) {
        const response = await fetch(poseImageUrl(item.id, 'img'))
        if (!response.ok) {
          const payload = await response.json().catch(() => null)
          throw new Error(payload?.error?.message || `姿态图读取失败（HTTP ${response.status}）`)
        }
        const blob = await response.blob()
        const extension = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'
        const loaded = await loadImageFile(new File([blob], `${item.id}.${extension}`, { type: blob.type }))
        const normalized = await normalizeForUpload(loaded)
        images.push({
          ...normalized,
          note: `姿态参考：${item.name || item.id}；仅参考动作、肢体关系与机位，人物身份、服装和场景以原图及需求为准。`,
        })
      }
      const wizard = useWizard.getState()
      if (!wizard.workflowId) wizard.start('recompose')
      for (const image of images) useWizard.getState().addReference(image)
      setNotice(`已把 ${images.length} 张姿态图加入参考图。`)
      openWizard()
    } catch (error) {
      setNotice(describe(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold">姿态参考库</h2>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          最多选择 4 张，加入后作为参考图参与分析；不会修改或复制图库源文件。
        </p>
        {meta && (
          <p className={`mt-2 text-xs ${meta.rootExists && meta.indexExists ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
            {meta.rootExists && meta.indexExists ? `图库已连接 · ${meta.root}` : `图库不可用 · ${meta.root}`}
          </p>
        )}
      </section>

      <section className="grid gap-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">搜索
          <input value={query} onChange={(event) => { setQuery(event.target.value); setLimit(PAGE_SIZE) }} placeholder="名称、标签、动作、机位" className="mt-1 min-h-11 w-full rounded-lg border border-neutral-300 bg-transparent px-3 dark:border-neutral-700" />
        </label>
        <Facet label="分类" value={l1} values={index?.facets.l1 ?? []} onChange={setL1} />
        <Facet label="动作" value={l2} values={index?.facets.l2 ?? []} onChange={setL2} />
        <Facet label="视角" value={l3} values={index?.facets.l3 ?? []} onChange={setL3} />
        <label className="flex min-h-11 items-center gap-2 self-end text-sm">
          <input type="checkbox" checked={includeAdult} onChange={(event) => setIncludeAdult(event.target.checked)} />
          显示成人向条目
        </label>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-500">找到 {filtered.length} 个 · 已选 {selected.length}/4</p>
        <button type="button" disabled={!selected.length || busy} onClick={() => void importSelected()} className="min-h-11 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-accent-500 dark:text-neutral-950">
          {busy ? '正在加入…' : '加入向导参考图'}
        </button>
      </div>

      {notice && <p role="status" className="rounded-lg bg-neutral-100 px-3 py-2 text-sm dark:bg-neutral-900">{notice}</p>}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {filtered.slice(0, limit).map((item) => {
          const active = selected.includes(item.id)
          return (
            <button key={item.id} type="button" aria-pressed={active} onClick={() => toggle(item.id)} className={`overflow-hidden rounded-xl border text-left transition ${active ? 'border-neutral-900 ring-2 ring-neutral-900 dark:border-white dark:ring-white' : 'border-neutral-200 hover:border-neutral-400 dark:border-neutral-800'}`}>
              <img src={poseImageUrl(item.id)} alt="" loading="lazy" className="aspect-[3/4] w-full bg-neutral-100 object-cover dark:bg-neutral-900" />
              <span className="block p-3">
                <span className="block truncate text-sm font-medium">{item.name || item.id}</span>
                <span className="mt-1 block truncate text-xs text-neutral-500">{[item.l2, item.l3].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
          )
        })}
      </section>

      {filtered.length > limit && (
        <button type="button" onClick={() => setLimit((value) => value + PAGE_SIZE)} className="min-h-11 w-full rounded-lg border border-neutral-300 px-4 text-sm dark:border-neutral-700">再显示 {Math.min(PAGE_SIZE, filtered.length - limit)} 个</button>
      )}
    </div>
  )
}

function Facet({ label, value, values, onChange }: { label: string; value: string; values: { value: string; count: number }[]; onChange: (value: string) => void }) {
  return (
    <label className="text-sm">{label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-neutral-300 bg-transparent px-3 dark:border-neutral-700">
        <option value="">全部</option>
        {values.map((item) => <option key={item.value} value={item.value}>{item.value}（{item.count}）</option>)}
      </select>
    </label>
  )
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
