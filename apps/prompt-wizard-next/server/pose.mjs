/**
 * Candidate pose library API.
 *
 * The browser can address images only by an id present in the bundled index.
 * It never supplies a filesystem path. This keeps the external library read-only
 * and prevents the endpoint from becoming a general local-file reader.
 */
import path from 'node:path'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const IMAGE_DIR = 'ai-pose-gallery-zh'
const here = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(here, '..')
const INDEX_PATH = path.join(PROJECT_ROOT, 'data', 'pose-index.json')
const META_PATH = path.join(PROJECT_ROOT, 'data', 'pose-index.meta.json')
const SAFE_LIBRARY_PATH = /^(img|thumbs)(\/[a-z0-9_-]+)?\/[^/\\]+\.(png|jpe?g|webp)$/i

let cache = { at: 0, index: null }

export function resolvePoseRoot(settings = {}) {
  return process.env.POSE_LIB_ROOT || settings.poseLibraryRoot || 'W:\\dsh\\ref-libs'
}

export function isSafePoseRelativePath(value) {
  return typeof value === 'string' && SAFE_LIBRARY_PATH.test(value)
}

export function visiblePoseItems(index, includeAdult = false) {
  const items = Array.isArray(index?.items) ? index.items : []
  return includeAdult ? items : items.filter((item) => !item.adult)
}

function loadIndex() {
  const now = Date.now()
  if (cache.index && now - cache.at < 30000) return cache.index
  if (!existsSync(INDEX_PATH)) return null
  const index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'))
  cache = { at: now, index }
  return index
}

function facet(items, key) {
  const counts = new Map()
  for (const item of items) {
    const value = item[key]
    if (typeof value !== 'string' || !value) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .map(([value, count]) => ({ value, count }))
}

function facetsOf(items) {
  const tags = new Map()
  for (const item of items) {
    for (const tag of [...(item.tags ?? []), ...(item.derived ?? [])]) {
      if (typeof tag === 'string' && tag) tags.set(tag, (tags.get(tag) ?? 0) + 1)
    }
  }
  return {
    lib: facet(items, 'lib'),
    l1: facet(items, 'l1'),
    l2: facet(items, 'l2'),
    l3: facet(items, 'l3'),
    hairLength: facet(items, 'hairLength'),
    hair: facet(items, 'hair'),
    tags: [...tags.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
      .map(([value, count]) => ({ value, count })),
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function contentTypeOf(file) {
  if (/\.png$/i.test(file)) return 'image/png'
  if (/\.webp$/i.test(file)) return 'image/webp'
  if (/\.jpe?g$/i.test(file)) return 'image/jpeg'
  return 'application/octet-stream'
}

export function handlePose(req, res, url, { readSettings }) {
  const action = url.pathname.slice('/api/pose/'.length)
  const root = resolvePoseRoot(readSettings())
  const libraryRoot = path.resolve(root, IMAGE_DIR)
  const index = loadIndex()

  if (req.method === 'GET' && action === 'meta') {
    const meta = existsSync(META_PATH) ? JSON.parse(readFileSync(META_PATH, 'utf8')) : null
    return sendJson(res, 200, {
      root,
      rootExists: existsSync(libraryRoot),
      indexExists: Boolean(index),
      builtAt: index?.builtAt ?? null,
      counts: meta?.counts ?? null,
      indexSize: meta?.sizeBytes ?? null,
    })
  }

  if (req.method === 'GET' && action === 'index') {
    if (!index) return sendJson(res, 503, { error: { message: '姿态索引不存在' } })
    const includeAdult = url.searchParams.get('adult') === '1'
    const items = visiblePoseItems(index, includeAdult)
    return sendJson(res, 200, {
      builtAt: index.builtAt,
      includeAdult,
      total: items.length,
      facets: facetsOf(items),
      items,
    })
  }

  if (req.method === 'GET' && action === 'file') {
    if (!index) return sendJson(res, 503, { error: { message: '姿态索引不存在' } })
    const id = url.searchParams.get('id') ?? ''
    const kind = url.searchParams.get('kind') === 'img' ? 'img' : 'thumb'
    const item = index.items.find((entry) => entry.id === id)
    if (!item) return sendJson(res, 404, { error: { message: '索引里没有这个姿态 ID' } })
    const relative = kind === 'img' ? item.img : item.thumb
    if (!isSafePoseRelativePath(relative)) {
      return sendJson(res, 400, { error: { message: '姿态图片路径不合法' } })
    }
    const absolute = path.resolve(libraryRoot, relative)
    if (absolute !== libraryRoot && !absolute.startsWith(libraryRoot + path.sep)) {
      return sendJson(res, 400, { error: { message: '姿态图片路径不合法' } })
    }
    if (!existsSync(absolute)) {
      return sendJson(res, 404, { error: { message: '姿态图片不存在，请检查图库目录设置' } })
    }
    const stat = statSync(absolute)
    res.writeHead(200, {
      'content-type': contentTypeOf(absolute),
      'content-length': stat.size,
      'cache-control': 'public, max-age=604800, immutable',
      'x-content-type-options': 'nosniff',
    })
    return createReadStream(absolute).pipe(res)
  }

  return sendJson(res, 404, { error: { message: '未知的姿态库接口' } })
}
