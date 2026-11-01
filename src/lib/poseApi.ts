/**
 * 姿势参考库的客户端接口。
 *
 * 索引一次拉齐放内存（约 1.5 MB），筛选全在前端做——
 * 每敲一个标签都去请求服务端会让筛选明显变卡。
 */

export type PoseItem = {
  id: string
  lib: 'pose' | 'costume' | 'portrait' | 'other'
  l1: string
  l2: string
  l3: string
  name: string
  group: string
  tags: string[]
  derived: string[]
  kw: string
  hair: string
  hairLength: string
  thumb: string
  img: string
  adult: boolean
}

export type FacetValue = { value: string; count: number }

export type PoseIndex = {
  builtAt: string
  includeAdult: boolean
  total: number
  facets: {
    lib: FacetValue[]
    l1: FacetValue[]
    l2: FacetValue[]
    l3: FacetValue[]
    hairLength: FacetValue[]
    hair: FacetValue[]
    tags: FacetValue[]
  }
  items: PoseItem[]
}

export type PoseMeta = {
  root: string
  rootExists: boolean
  indexExists: boolean
  builtAt: string | null
  counts: { total: number; pose: number; costume: number; portrait: number; adult: number } | null
  indexSize: number | null
}

export async function fetchPoseMeta(): Promise<PoseMeta> {
  const res = await fetch('/api/pose/meta')
  if (!res.ok) throw new Error('读取参考库状态失败')
  return res.json()
}

export async function fetchPoseIndex(includeAdult: boolean): Promise<PoseIndex> {
  const res = await fetch(`/api/pose/index?adult=${includeAdult ? 1 : 0}`)
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(detail?.error?.message ?? '读取索引失败')
  }
  return res.json()
}

export type PoseExportResult = {
  dir: string
  kind: 'img' | 'thumb'
  copied: { id: string; to: string }[]
  failed: { id: string; reason: string }[]
}

/** 导出到指定目录：复制由服务端做（它握着索引和库根）。 */
export async function exportPoses(ids: string[], dir: string, kind: 'img' | 'thumb' = 'img'): Promise<PoseExportResult> {
  const res = await fetch('/api/pose/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids, dir, kind, probe: '.pose-write-test' }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error?.message ?? '导出失败')
  return data as PoseExportResult
}

/** 缩略图/原图地址：只传 id，路径由服务端查索引得到。 */
export function poseFileUrl(id: string, kind: 'thumb' | 'img' = 'thumb'): string {
  return `/api/pose/file?kind=${kind}&id=${encodeURIComponent(id)}`
}

export type PoseFilter = {
  lib: string
  l1: string[]
  l2: string[]
  l3: string[]
  tags: string[]
  hairLength: string[]
  hair: string[]
  keyword: string
}

export const EMPTY_FILTER: PoseFilter = {
  lib: '',
  l1: [],
  l2: [],
  l3: [],
  tags: [],
  hairLength: [],
  hair: [],
  keyword: '',
}

const hit = (selected: string[], value: string) => selected.length === 0 || selected.includes(value)

/** 维度内 OR、维度间 AND；关键词命中名称/ID/英文词。 */
export function filterPoses(items: PoseItem[], filter: PoseFilter): PoseItem[] {
  const key = filter.keyword.trim().toLowerCase()
  return items.filter((item) => {
    if (filter.lib && item.lib !== filter.lib) return false
    if (!hit(filter.l1, item.l1)) return false
    if (!hit(filter.l2, item.l2)) return false
    if (!hit(filter.l3, item.l3)) return false
    if (!hit(filter.hairLength, item.hairLength)) return false
    if (!hit(filter.hair, item.hair)) return false
    if (filter.tags.length > 0) {
      const own = [...item.tags, ...item.derived]
      if (!filter.tags.every((tag) => own.includes(tag))) return false
    }
    if (key) {
      const haystack = `${item.name} ${item.id} ${item.kw}`.toLowerCase()
      if (!haystack.includes(key)) return false
    }
    return true
  })
}
