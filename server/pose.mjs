/**
 * 姿势参考库接口。
 *
 * 只读：索引 + 图片。图片按 id 取，不允许传路径，
 * 因为路径来自索引，索引里没有的 id 一律拒绝——避免任意文件读取。
 *
 * 库根优先级：环境变量 POSE_LIB_ROOT > 设置里的 poseLibraryRoot > 默认 W:\dsh\ref-libs
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, createReadStream, statSync, mkdirSync, copyFileSync, writeFileSync, unlinkSync } from 'node:fs'

const IMAGE_DIR = 'ai-pose-gallery-zh'
// 用模块自身位置推项目根：打包后 process.cwd() 不是应用目录，
// 用 cwd 会找不到 data/pose-index.json（表现为「索引不存在」）。
const here = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(here, '..')

let cache = { at: 0, index: null, root: '' }

function indexPath() {
  return path.join(PROJECT_ROOT, 'data', 'pose-index.json')
}

function metaPath() {
  return path.join(PROJECT_ROOT, 'data', 'pose-index.meta.json')
}

function resolveRoot(settings) {
  return process.env.POSE_LIB_ROOT || settings?.poseLibraryRoot || 'W:\\dsh\\ref-libs'
}

function loadIndex(root) {
  const now = Date.now()
  if (cache.index && cache.root === root && now - cache.at < 30000) return cache.index
  const file = indexPath()
  if (!existsSync(file)) return null
  const index = JSON.parse(readFileSync(file, 'utf8'))
  cache = { at: now, index, root }
  return index
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(text)
}

function contentTypeOf(file) {
  if (file.endsWith('.png')) return 'image/png'
  if (file.endsWith('.webp')) return 'image/webp'
  if (file.endsWith('.jpg') || file.endsWith('.jpeg')) return 'image/jpeg'
  return 'application/octet-stream'
}

export async function handlePose(req, res, url, { readSettings, readBody }) {
  const action = url.pathname.slice('/api/pose/'.length)

  if (req.method === 'GET' && action === 'meta') {
    const root = resolveRoot(readSettings())
    const index = loadIndex(root)
    const meta = existsSync(metaPath()) ? JSON.parse(readFileSync(metaPath(), 'utf8')) : null
    return sendJson(res, 200, {
      root,
      rootExists: existsSync(path.join(root, IMAGE_DIR)),
      indexExists: Boolean(index),
      builtAt: index?.builtAt ?? null,
      counts: meta?.counts ?? null,
      facets: index?.facets ?? null,
      indexSize: meta?.sizeBytes ?? null,
    })
  }

  if (req.method === 'GET' && action === 'index') {
    const root = resolveRoot(readSettings())
    const index = loadIndex(root)
    if (!index) return sendJson(res, 503, { error: { message: '索引不存在，请先运行 scripts/build-pose-index.mjs' } })
    const includeAdult = url.searchParams.get('adult') === '1'
    const items = includeAdult ? index.items : index.items.filter((item) => !item.adult)
    // 分面计数跟着「是否含成人向」一起变，避免筛选栏出现选了就空的值
    const facet = (key) => {
      const map = new Map()
      for (const item of items) {
        const value = item[key]
        if (!value) continue
        map.set(value, (map.get(value) ?? 0) + 1)
      }
      return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }))
    }
    const tagMap = new Map()
    for (const item of items) for (const tag of [...item.tags, ...item.derived]) tagMap.set(tag, (tagMap.get(tag) ?? 0) + 1)
    return sendJson(res, 200, {
      builtAt: index.builtAt,
      includeAdult,
      total: items.length,
      facets: {
        lib: facet('lib'),
        l1: facet('l1'),
        l2: facet('l2'),
        l3: facet('l3'),
        hairLength: facet('hairLength'),
        hair: facet('hair'),
        tags: [...tagMap.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count })),
      },
      items,
    })
  }

  if (req.method === 'GET' && action === 'file') {
    const root = resolveRoot(readSettings())
    const index = loadIndex(root)
    if (!index) return sendJson(res, 503, { error: { message: '索引不存在' } })
    const id = url.searchParams.get('id') ?? ''
    const kind = url.searchParams.get('kind') === 'img' ? 'img' : 'thumb'
    const item = index.items.find((entry) => entry.id === id)
    if (!item) return sendJson(res, 404, { error: { message: '索引里没有这个 id' } })
    const relative = kind === 'img' ? item.img : item.thumb
    // 只接受形如 img/xxx.png 的相对路径，防止 ../ 逃逸
    if (!relative || !/^(img|thumbs)(\/[a-z0-9_-]+)?\/[^/\\]+\.(png|jpe?g|webp)$/i.test(relative)) {
      return sendJson(res, 400, { error: { message: '路径不合法' } })
    }
    const absolute = path.join(root, IMAGE_DIR, relative)
    if (!absolute.startsWith(path.join(root, IMAGE_DIR))) return sendJson(res, 400, { error: { message: '路径不合法' } })
    if (!existsSync(absolute)) return sendJson(res, 404, { error: { message: '文件不存在（库可能被移动）' } })
    const stat = statSync(absolute)
    res.writeHead(200, {
      'content-type': contentTypeOf(absolute),
      'content-length': stat.size,
      // 图片按 id 寻址，内容不会变，可以长缓存
      'cache-control': 'public, max-age=604800, immutable',
    })
    return createReadStream(absolute).pipe(res)
  }

  if (req.method === 'POST' && action === 'export') {
    const root = resolveRoot(readSettings())
    const index = loadIndex(root)
    if (!index) return sendJson(res, 503, { error: { message: '索引不存在' } })
    let body
    try {
      body = await readBody(req)
    } catch (error) {
      return sendJson(res, 400, { error: { message: error instanceof Error ? error.message : String(error) } })
    }
    const ids = Array.isArray(body?.ids) ? body.ids.filter((id) => typeof id === 'string').slice(0, 200) : []
    const dir = typeof body?.dir === 'string' ? body.dir : ''
    const kind = body?.kind === 'img' ? 'img' : 'thumb'
    if (ids.length === 0) return sendJson(res, 400, { error: { message: '没有要导出的图' } })
    if (!dir) return sendJson(res, 400, { error: { message: '没有指定下载目录' } })
    try {
      // 目录不存在就建；建不出来说明路径不可用，直接报错，不静默失败
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const probe = typeof body?.probe === 'string' ? body.probe : ''
      if (probe) {
        const probePath = path.join(dir, probe)
        try {
          writeFileSync(probePath, 'ok')
          unlinkSync(probePath)
        } catch {
          return sendJson(res, 400, { error: { message: '目录不可写，请换一个位置' } })
        }
      }
    } catch (error) {
      return sendJson(res, 400, { error: { message: `目录不可用：${error instanceof Error ? error.message : String(error)}` } })
    }

    const copied = []
    const failed = []
    for (const id of ids) {
      const item = index.items.find((entry) => entry.id === id)
      if (!item) { failed.push({ id, reason: '索引里没有这个 id' }); continue }
      const relative = kind === 'img' ? item.img : item.thumb
      if (!relative || !/^(img|thumbs)(\/[a-z0-9_-]+)?\/[^/\\]+\.(png|jpe?g|webp)$/i.test(relative)) {
        failed.push({ id, reason: '路径不合法' })
        continue
      }
      const source = path.join(root, IMAGE_DIR, relative)
      if (!existsSync(source)) { failed.push({ id, reason: '源文件不存在' }); continue }
      const ext = path.extname(relative)
      const safeName = (item.name || item.id).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
      let target = path.join(dir, `${safeName}_${item.id}${ext}`)
      // 重名不覆盖：依次加 -2、-3
      let suffix = 2
      while (existsSync(target)) {
        target = path.join(dir, `${safeName}_${item.id}-${suffix}${ext}`)
        suffix += 1
        if (suffix > 99) break
      }
      try {
        copyFileSync(source, target)
        copied.push({ id, to: target })
      } catch (error) {
        failed.push({ id, reason: error instanceof Error ? error.message : String(error) })
      }
    }
    return sendJson(res, 200, { dir, kind, copied, failed })
  }
  return sendJson(res, 404, { error: { message: '未知的姿势库接口' } })
}
