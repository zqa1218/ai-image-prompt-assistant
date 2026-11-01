import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { chatJson } from '../lib/llm/client.ts'
import { useWizard } from '../lib/wizardStore.ts'
import {
  fetchPoseIndex,
  filterPoses,
  poseFileUrl,
  EMPTY_FILTER,
  type PoseFilter,
  type PoseItem,
} from '../lib/poseApi.ts'

/**
 * 姿势线里的「选姿势」阶段。
 *
 * 只保留这条线真正需要的部分：按姿势库三分类筛 → 挑 1–3 张 → 确认。
 * 不做下载（下载在导出一环），也不做成人向显示（这条线默认只给标准/上半身体系）。
 */
export type PoseChoice = { id: string; name: string; l1: string; l2: string; l3: string }

export default function PoseStage({
  busy,
  onConfirm,
}: {
  busy: boolean
  onConfirm: (list: PoseChoice[]) => void
}) {
  const [items, setItems] = useState<PoseItem[]>([])
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<PoseFilter>({ ...EMPTY_FILTER, lib: 'pose' })
  const [picked, setPicked] = useState<PoseChoice[]>([])
  const [advice, setAdvice] = useState('')
  const [applied, setApplied] = useState<string[]>([])
  const [advising, setAdvising] = useState(false)
  const original = useWizard((s) => s.original)
  const requirement = useWizard((s) => s.intake.requirement ?? '')
  const poseHint = useWizard((s) => s.intake.poseHint ?? '')
  const analysis = useWizard((s) => (s.records["analyze"]?.output as string | undefined) ?? "")
  const selected = useWizard((s) => {
    const option = s.options.find((entry) => entry.id === s.selectedOptionId)
    return option ? `${option.title}：${option.change ?? ""}` : ""
  })

  useEffect(() => {
    fetchPoseIndex(false)
      .then((data) => setItems(data.items.filter((item) => item.lib === 'pose')))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  const results = useMemo(() => filterPoses(items, filter), [items, filter])

  const facets = (key: 'l1' | 'l2' | 'l3') => {
    const map = new Map<string, number>()
    for (const item of items) {
      const value = item[key]
      if (value) map.set(value, (map.get(value) ?? 0) + 1)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }))
  }

  /**
   * AI 推荐：模型只能从库里真实存在的标签里选。
   * 白名单直接由索引分面生成——这是硬约束，不靠模型自觉。
   */
  const recommend = async () => {
    if (items.length === 0) return
    const white = {
      体系: [...new Set(items.map((item) => item.l1).filter(Boolean))],
      动作: [...new Set(items.map((item) => item.l2).filter(Boolean))],
      视角: [...new Set(items.map((item) => item.l3).filter(Boolean))],
    }
    setAdvising(true)
    setAdvice('')
    try {
      const content = [
        { type: 'text' as const, text: '这是用户要优化的原图。' },
        ...(original?.dataUrl ? [{ type: 'image_url' as const, image_url: { url: original.dataUrl } }] : []),
        {
          type: 'text' as const,
          text:
            `用户想解决的问题：${requirement || '（未填写）'}\n姿势偏好：${poseHint || '（无）'}\n\n` +
            (analysis ? `原图分析（节选）：\n${analysis.slice(0, 1800)}\n\n` : '') +
            (selected ? `已选方案：${selected}\n\n` : '') +
            `请判断这张图现在的姿势问题，并从下面的标签白名单里给出 2–5 个推荐值，用来从白膜姿势库中筛选合适的骨架。\n` +
            `体系：${white.体系.join('、')}\n动作：${white.动作.join('、')}\n视角：${white.视角.join('、')}\n\n` +
            `只能使用上面出现过的值，不要发明新标签。\n\n` +
            `以 json 输出，字段固定为：{"diagnosis":"现在姿势的问题","picks":[{"dim":"体系|动作|视角","value":"标签值"}],"reason":"为什么这几个值能筛出合适的骨架"}。`,
        },
      ]
      const schema = z.object({
        diagnosis: z.string(),
        picks: z.array(z.object({ dim: z.enum(['体系', '动作', '视角']), value: z.string() })),
        reason: z.string(),
      })
      const outcome = await chatJson(
        {
          conversationId: 'pose-recommend',
          messages: [{ role: 'user', content }],
          thinking: 'enabled',
          effort: 'low',
          maxTokens: 700,
        },
        schema,
      )
      if (!outcome.ok) throw new Error(outcome.reason || '模型没有给出可用结果')
      const adviceData = outcome.data
      const valid = adviceData.picks.filter((pick) => white[pick.dim].includes(pick.value))
      const dropped = adviceData.picks.length - valid.length
      const next = { ...filter, l1: [] as string[], l2: [] as string[], l3: [] as string[] }
      const keyOf = { 体系: 'l1', 动作: 'l2', 视角: 'l3' } as const
      for (const pick of valid) next[keyOf[pick.dim]] = [...next[keyOf[pick.dim]], pick.value]
      setFilter(next)
      // 记下这次方案实际用了哪组标签，界面上要能一眼看到（而不是只表现为 chip 变亮）
      setApplied(valid.map((p) => `${p.dim}：${p.value}`))
      setAdvice(
        `${adviceData.diagnosis}\n推荐：${valid.map((p) => `${p.dim}=${p.value}`).join('、') || '（无）'}` +
          (dropped > 0 ? `\n已丢弃 ${dropped} 个库里不存在的标签` : '') +
          (adviceData.reason ? `\n理由：${adviceData.reason}` : ''),
      )
    } catch (error) {
      setAdvice(error instanceof Error ? error.message : String(error))
    } finally {
      setAdvising(false)
    }
  }

  // 选了方案后直接进入选姿势时，自动按方案推荐一次标签，省掉手动点按钮
  useEffect(() => {
    if (!selected || applied.length > 0 || advising || items.length === 0) return
    const timer = setTimeout(() => { void recommend() }, 600)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, items.length])
  const toggle = (item: PoseItem) => {
    const exists = picked.some((entry) => entry.id === item.id)
    if (exists) {
      setPicked(picked.filter((entry) => entry.id !== item.id))
      return
    }
    // 最多 3 张：再多模型会分不清该以哪张为主
    if (picked.length >= 3) return
    setPicked([...picked, { id: item.id, name: item.name || item.id, l1: item.l1, l2: item.l2, l3: item.l3 }])
  }

  if (error) return <p className="text-sm text-warn">{error}</p>

  return (
    <div className="space-y-4">
      <section className="surface-row space-y-2">
        <h2 className="section-title">选姿势</h2>
        <p className="text-xs text-fg-muted">
          在白膜库里挑 1–3 张作骨架参考。只借重心、肢体朝向与张力，不借它的外观。
        </p>
        <div className="space-y-2 pt-1">
          {(['l1', 'l2', 'l3'] as const).map((key) => (
            <div key={key} className="flex flex-wrap items-center gap-2">
              <span className="w-14 shrink-0 text-xs text-fg-dim">{DIM_LABEL[key]}</span>
              {facets(key).map((entry) => {
                const active = filter[key].includes(entry.value)
                return (
                  <button
                    key={entry.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setFilter({
                        ...filter,
                        [key]: active ? filter[key].filter((v) => v !== entry.value) : [...filter[key], entry.value],
                      })
                    }
                    className={
                      'focus-ring rounded-full border px-2.5 py-1 text-xs ' +
                      (active ? 'border-accent bg-accent-soft text-fg' : 'border-line text-fg-muted hover:border-line-strong')
                    }
                  >
                    {entry.value} {entry.count}
                  </button>
                )
              })}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-14 shrink-0 text-xs text-fg-dim">关键词</span>
            <input
              value={filter.keyword}
              onChange={(event) => setFilter({ ...filter, keyword: event.target.value })}
              placeholder="名称 / ID"
              className="w-52 px-2.5 py-1.5 text-xs"
            />
            <span className="text-xs text-fg-dim">命中 {results.length} 张</span>
            <button
              type="button"
              disabled={advising || items.length === 0}
              onClick={() => void recommend()}
              className="focus-ring rounded-[10px] border border-accent/50 bg-accent-soft px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              {advising ? '分析中…' : '让 AI 推荐标签'}
            </button>
          </div>
        </div>
      </section>

      {applied.length > 0 && (
        <section className="surface-row space-y-2">
          <h3 className="text-sm font-medium">本方案用的标签</h3>
          <div className="flex flex-wrap gap-2">
            {applied.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-accent bg-accent-soft px-2.5 py-1 text-xs font-medium text-fg"
              >
                {tag}
              </span>
            ))}
          </div>
          <p className="text-xs text-fg-dim">这些标签已点亮在上方筛选栏里，下面就是按这组条件筛出来的结果。</p>
        </section>
      )}

      {advice && (
        <section className="surface-row space-y-1">
          <h3 className="text-sm font-medium">AI 建议</h3>
          <p className="whitespace-pre-wrap text-xs text-fg-muted">{advice}</p>
        </section>
      )}

      <section className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {results.slice(0, 48).map((item) => {
          const active = picked.some((entry) => entry.id === item.id)
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => toggle(item)}
              className={
                'surface-row !p-1 text-left ' + (active ? 'ring-2 ring-[var(--color-accent)]' : '')
              }
              title={`${item.name} · ${item.l1}/${item.l2}/${item.l3}`}
            >
              <img
                src={poseFileUrl(item.id, 'thumb')}
                alt={item.name}
                loading="lazy"
                className="aspect-[3/4] w-full rounded object-cover"
              />
              <p className="mt-1 truncate text-[10px] text-fg-dim">{item.l2 || item.l1}</p>
            </button>
          )
        })}
      </section>
      {results.length > 48 && (
        <p className="text-center text-xs text-fg-dim">只显示前 48 张，用上面的标签缩小范围</p>
      )}

      <section className="surface-row space-y-2">
        <h3 className="text-sm font-medium">已选 {picked.length} / 3</h3>
        {picked.length === 0 ? (
          <p className="text-xs text-fg-dim">还没选。点缩略图即可选中，最多 3 张。</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {picked.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setPicked(picked.filter((x) => x.id !== entry.id))}
                className="focus-ring rounded-md border border-accent/50 bg-accent-soft px-2 py-1 text-xs"
              >
                {entry.name} ×
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          disabled={busy || picked.length === 0}
          onClick={() => onConfirm(picked)}
          className="focus-ring rounded-lg bg-accent px-4 py-2 text-sm font-medium text-ink-900 disabled:cursor-not-allowed disabled:bg-ink-750 disabled:text-fg-muted"
        >
          用这 {picked.length} 张去下载
        </button>
      </section>
    </div>
  )
}

const DIM_LABEL: Record<'l1' | 'l2' | 'l3', string> = { l1: '体系', l2: '动作', l3: '视角' }
