import { useEffect, useMemo, useRef, useState } from 'react'
import { confirmAction } from '../lib/confirmDialog.ts'
import {
  EMPTY_FILTER,
  fetchPoseIndex,
  fetchPoseMeta,
  exportPoses,
  filterPoses,
  poseFileUrl,
  type PoseFilter,
  type PoseIndex,
  type PoseItem,
  type PoseMeta,
} from '../lib/poseApi.ts'

/**
 * 姿势参考库。
 *
 * 两个关键决定：
 * 1. 检索全在前端——索引一次拉齐，切标签是内存过滤，没有网络往返。
 * 2. **维度含义随「库」切换**：姿势库是 体系/动作/视角，服装库是 分类/标签，
 *    人像库是 分区/发长/发型。三个库共用 l1/l2/l3 字段但语义不同，
 *    所以分面一律按当前库现算，绝不用全局混合值——否则会出现
 *    「动作：短发」这种错位选项。
 */
const PAGE_SIZE = 60
const ADULT_KEY = 'promptwizard.poseAdult'
const DIR_KEY = 'promptwizard.poseDir'

const LIB_LABEL: Record<string, string> = { pose: '姿势', costume: '服装', portrait: '人像发型' }

/** 每个库的维度标签（key 对应索引字段）。 */
const LIB_DIMENSIONS: Record<string, { key: 'l1' | 'l2' | 'l3' | 'tags'; label: string }[]> = {
  pose: [
    { key: 'l1', label: '体系' },
    { key: 'l2', label: '动作' },
    { key: 'l3', label: '视角' },
  ],
  costume: [
    { key: 'l1', label: '分类' },
    { key: 'tags', label: '标签' },
  ],
  portrait: [
    { key: 'l1', label: '分区' },
    { key: 'l2', label: '发长' },
    { key: 'l3', label: '发型' },
  ],
}

const valuesOf = (item: PoseItem, key: 'l1' | 'l2' | 'l3' | 'tags'): string[] => {
  if (key === 'tags') return [...item.tags, ...item.derived]
  const value = item[key]
  return value ? [value] : []
}

/** 按当前库现算分面：选项一定存在于可见结果里。 */
function facetsFor(items: PoseItem[], key: 'l1' | 'l2' | 'l3' | 'tags') {
  const map = new Map<string, number>()
  for (const item of items) {
    for (const value of valuesOf(item, key)) map.set(value, (map.get(value) ?? 0) + 1)
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }))
}

export default function PosePage() {
  const [meta, setMeta] = useState<PoseMeta | null>(null)
  const [index, setIndex] = useState<PoseIndex | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [includeAdult, setIncludeAdult] = useState(() => localStorage.getItem(ADULT_KEY) === '1')
  const [filter, setFilter] = useState<PoseFilter>({ ...EMPTY_FILTER, lib: 'pose' })
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [picked, setPicked] = useState<PoseItem[]>([])
  const [preview, setPreview] = useState<PoseItem | null>(null)
  const [dir, setDir] = useState(() => localStorage.getItem(DIR_KEY) ?? '')
  const [kind, setKind] = useState<'img' | 'thumb'>('img')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const sentinel = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchPoseMeta()
      .then(async (next) => {
        if (!alive) return
        setMeta(next)
        if (!next.indexExists) throw new Error('索引不存在，请先运行 scripts/build-pose-index.mjs')
        const data = await fetchPoseIndex(includeAdult)
        if (alive) setIndex(data)
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [includeAdult])

  const results = useMemo(() => (index ? filterPoses(index.items, filter) : []), [index, filter])

  /** 分面基于「当前库 + 当前其它条件」的可见结果，避免选了就空。 */
  const scopedItems = useMemo(() => {
    if (!index) return []
    return filter.lib ? index.items.filter((item) => item.lib === filter.lib) : index.items
  }, [index, filter.lib])

  const dimensions = filter.lib ? LIB_DIMENSIONS[filter.lib] ?? [] : []

  useEffect(() => setLimit(PAGE_SIZE), [filter])

  useEffect(() => {
    const node = sentinel.current
    if (!node) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setLimit((current) => (current >= results.length ? current : current + PAGE_SIZE))
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [results.length])

  const toggleAdult = async () => {
    if (!includeAdult) {
      const ok = await confirmAction({
        title: '显示成人向分类？',
        message:
          '姿势库里有两个标为成人向的体系（性感系、双人缠绵）。开启后它们会出现在检索结果里，并同样可被导出。',
        confirmLabel: '开启显示',
      })
      if (!ok) return
      localStorage.setItem(ADULT_KEY, '1')
      setIncludeAdult(true)
      return
    }
    localStorage.setItem(ADULT_KEY, '0')
    setIncludeAdult(false)
  }

  const chooseDir = async () => {
    const bridge = window.pwShell
    if (!bridge?.pickPoseDir) {
      setResult('当前环境不支持选择目录，请在桌面版里导出。')
      return
    }
    const next = await bridge.pickPoseDir()
    if (!next) return
    localStorage.setItem(DIR_KEY, next)
    setDir(next)
    setResult('')
  }

  const doExport = async () => {
    if (!dir) { setResult('先选择下载目录。'); return }
    if (picked.length === 0) { setResult('还没有选中的图。'); return }
    setBusy(true)
    setResult('')
    try {
      const out = await exportPoses(picked.map((item) => item.id), dir, kind)
      const failNote = out.failed.length > 0 ? `，${out.failed.length} 张失败（${out.failed[0].reason}）` : ''
      setResult(`已导出 ${out.copied.length} 张到 ${out.dir}${failNote}`)
    } catch (error) {
      setResult(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const setDimension = (key: 'l1' | 'l2' | 'l3' | 'tags', next: string[]) => {
    setFilter({ ...filter, [key]: next } as PoseFilter)
  }

  if (loading) return <p className="text-sm text-fg-muted">正在读取参考库…</p>

  if (error) {
    return (
      <section className="surface-row space-y-2">
        <h2 className="section-title">姿势参考库</h2>
        <p className="text-sm text-warn">{error}</p>
        <p className="text-xs text-fg-muted">
          参考库需要本地图片：请确认 {meta?.root ?? '库路径'} 存在，且已运行索引脚本。
        </p>
      </section>
    )
  }

  return (
    <div className="space-y-4">
      <section className="surface-row space-y-3">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="section-title">姿势参考库</h2>
            <p className="text-xs text-fg-muted">
              共 {index?.total ?? 0} 条 · 索引 {meta?.builtAt?.slice(0, 10) ?? '—'}
              {includeAdult ? ' · 含成人向' : ' · 已屏蔽成人向'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void toggleAdult()}
              className="focus-ring rounded-[10px] border border-line px-2.5 py-1 text-xs text-fg-muted hover:border-line-strong"
            >
              {includeAdult ? '隐藏成人向' : '显示成人向'}
            </button>
            <button
              type="button"
              onClick={() => { setFilter({ ...EMPTY_FILTER, lib: filter.lib }); setPicked([]) }}
              className="focus-ring rounded-[10px] border border-line px-2.5 py-1 text-xs text-fg-muted hover:border-line-strong"
            >
              清空条件
            </button>
          </div>
        </header>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-fg-dim">库</span>
            <Chip label="全部" active={filter.lib === ''} onClick={() => setFilter({ ...EMPTY_FILTER })} />
            {(index?.facets.lib ?? []).map((entry) => (
              <Chip
                key={entry.value}
                label={`${LIB_LABEL[entry.value] ?? entry.value} ${entry.count}`}
                active={filter.lib === entry.value}
                onClick={() => setFilter({ ...EMPTY_FILTER, lib: entry.value })}
              />
            ))}
          </div>

          {dimensions.map((dim) => (
            <FacetRow
              key={dim.key}
              label={dim.label}
              values={facetsFor(scopedItems, dim.key)}
              selected={(filter[dim.key] as string[]) ?? []}
              onChange={(next) => setDimension(dim.key, next)}
              max={dim.key === 'l1' ? 8 : dim.key === 'l3' ? 10 : 12}
            />
          ))}

          {filter.lib === '' && (
            <p className="text-xs text-fg-dim">
              选一个库后才能按该库的维度筛选——三个库的「一级/二级/三级」含义不同（姿势是体系/动作/视角，服装是分类/标签，人像是分区/发长/发型）。
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-fg-dim">关键词</span>
            <input
              value={filter.keyword}
              onChange={(event) => setFilter({ ...filter, keyword: event.target.value })}
              placeholder="名称 / ID / 英文词"
              className="w-56 px-2.5 py-1.5 text-xs"
            />
          </div>
        </div>

        <p className="text-xs text-fg-dim">
          命中 <b className="text-fg">{results.length}</b> 条
          {picked.length > 0 && ` · 已选 ${picked.length} 张`}
        </p>
      </section>

      {picked.length > 0 && (
        <section className="surface-row space-y-2">
          <h3 className="text-sm font-medium">已选（{picked.length}）</h3>
          <div className="flex flex-wrap gap-2">
            {picked.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setPicked(picked.filter((x) => x.id !== item.id))}
                className="focus-ring rounded-md border border-accent/50 bg-accent-soft px-2 py-1 text-xs"
                title="点击移除"
              >
                {item.name || item.id} ×
              </button>
            ))}
          </div>
          <div className="space-y-2 border-t border-line pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-fg-dim">下载目录</span>
              <code className="max-w-[360px] truncate rounded bg-ink-850 px-2 py-1 text-[11px] text-fg-muted">{dir || '未设置'}</code>
              <button type="button" onClick={() => void chooseDir()} className="focus-ring rounded-[10px] border border-line px-2.5 py-1 text-xs hover:border-line-strong">
                {dir ? '更换目录' : '选择目录'}
              </button>
              {dir && window.pwShell?.revealDir && (
                <button type="button" onClick={() => void window.pwShell?.revealDir(dir)} className="focus-ring rounded-[10px] border border-line px-2.5 py-1 text-xs hover:border-line-strong">
                  打开目录
                </button>
              )}
              <select value={kind} onChange={(event) => setKind(event.target.value === 'thumb' ? 'thumb' : 'img')} className="px-2 py-1 text-xs">
                <option value="img">原图 PNG</option>
                <option value="thumb">缩略图 JPG</option>
              </select>
              <button
                type="button"
                disabled={busy || !dir}
                onClick={() => void doExport()}
                className="focus-ring rounded-[10px] border border-accent/50 bg-accent-soft px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? '导出中…' : `导出所选（${picked.length}）`}
              </button>
            </div>
            {!dir && <p className="text-xs text-warn">导出前必须先选下载目录。</p>}
            {result && <p className="text-xs text-fg-muted">{result}</p>}
          </div>
        </section>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {results.slice(0, limit).map((item) => {
          const selected = picked.some((x) => x.id === item.id)
          return (
            <figure key={item.id} className={'surface-row !p-2 space-y-1 ' + (selected ? 'ring-1 ring-[var(--color-accent)]' : '')}>
              <button type="button" className="block w-full" onClick={() => setPreview(item)}>
                <img
                  src={poseFileUrl(item.id, 'thumb')}
                  alt={item.name || item.id}
                  loading="lazy"
                  className="aspect-[3/4] w-full rounded-md object-cover"
                />
              </button>
              <figcaption className="space-y-1">
                <p className="truncate text-xs font-medium" title={item.name || item.id}>
                  {item.name || item.id}
                </p>
                <p className="truncate text-[11px] text-fg-dim">
                  {[item.l1, item.l2, item.l3].filter(Boolean).join(' · ') || LIB_LABEL[item.lib]}
                </p>
                <button
                  type="button"
                  onClick={() => setPicked(selected ? picked.filter((x) => x.id !== item.id) : [...picked, item])}
                  className="focus-ring w-full rounded-md border border-line px-2 py-1 text-[11px] hover:border-line-strong"
                >
                  {selected ? '已选' : '选中'}
                </button>
              </figcaption>
            </figure>
          )
        })}
      </section>

      <div ref={sentinel} className="h-8" />
      {limit < results.length && (
        <p className="text-center text-xs text-fg-dim">继续下滑加载更多（{limit} / {results.length}）</p>
      )}
      {results.length === 0 && <p className="text-sm text-fg-muted">没有符合条件的图，放宽几个标签再试。</p>}

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6"
          onClick={() => setPreview(null)}
        >
          <div className="max-h-full max-w-4xl overflow-auto" onClick={(event) => event.stopPropagation()}>
            <img src={poseFileUrl(preview.id, 'img')} alt={preview.name} className="max-h-[80vh] rounded-lg" />
            <p className="mt-2 text-center text-xs text-fg-muted">
              {preview.name || preview.id} · {[preview.l1, preview.l2, preview.l3].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function Chip(props: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-pressed={props.active}
      className={
        'focus-ring rounded-full border px-2.5 py-1 text-xs ' +
        (props.active ? 'border-accent bg-accent-soft text-fg' : 'border-line text-fg-muted hover:border-line-strong')
      }
    >
      {props.label}
    </button>
  )
}

function FacetRow(props: {
  label: string
  values: { value: string; count: number }[]
  selected: string[]
  onChange: (next: string[]) => void
  max?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const limit = props.max ?? 10
  const shown = expanded ? props.values : props.values.slice(0, limit)
  if (props.values.length === 0) return null
  const toggle = (value: string) =>
    props.onChange(props.selected.includes(value) ? props.selected.filter((v) => v !== value) : [...props.selected, value])
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-fg-dim">{props.label}</span>
      {shown.map((entry) => (
        <Chip
          key={entry.value}
          label={`${entry.value} ${entry.count}`}
          active={props.selected.includes(entry.value)}
          onClick={() => toggle(entry.value)}
        />
      ))}
      {props.values.length > limit && (
        <button type="button" onClick={() => setExpanded(!expanded)} className="text-xs text-fg-muted underline">
          {expanded ? '收起' : `还有 ${props.values.length - limit} 个`}
        </button>
      )}
    </div>
  )
}
