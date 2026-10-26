import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { DATA_DIR } from './config.mjs'
import { iterationService } from './iteration-server.mjs'
import { assert, exact } from '../dist/assets/iteration-core.mjs'
import { sourceOf, libraryParts, validateLibrary, LIBRARY_SCHEMA, LIBRARY_RULES, WORKFLOW_NAMES } from '../dist/assets/library-core.mjs'

export function createLibraryService({ dataDir = DATA_DIR, api = iterationService, schedule = true } = {}) {
  const dir = path.join(dataDir, 'prompt-library'), settingsFile = path.join(dir, 'settings.json')
  let working = false, timer, initialized = false
  function atomic(file, value) {
    mkdirSync(dir, { recursive: true })
    const tmp = file + '.' + randomUUID() + '.tmp'
    writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 })
    renameSync(tmp, file)
  }
  const idOf = id => { assert(typeof id === 'string' && /^[a-f0-9]{64}$/.test(id), '无效档案 ID'); return path.join(dir, id + '.json') }
  const read = id => { const file = idOf(id); assert(existsSync(file), '档案不存在'); return JSON.parse(readFileSync(file, 'utf8')) }
  const write = record => atomic(idOf(record.id), { ...record, updatedAt: new Date().toISOString() })
  function records() {
    const items = [], damaged = []
    if (existsSync(dir)) for (const file of readdirSync(dir).filter(f => /^[a-f0-9]{64}\.json$/.test(f))) {
      try { const r = read(file.slice(0, -5)); assert(r.id === file.slice(0, -5) && r.source?.artifact?.prompt, '档案结构损坏'); items.push(r) } catch { damaged.push(file) }
    }
    return { items, damaged }
  }
  function init() {
    if (initialized) return
    initialized = true
    for (const r of records().items) if (r.status === 'processing') write({ ...r, status: 'error', error: '上次整理在程序退出时中断，可能已经计费；请检查后手动重试，不会自动重复调用。' })
    wake()
  }
  function settings() {
    return existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, 'utf8')) : { autoProcess: false, profileId: '' }
  }
  function saveSettings(value) {
    exact(value, ['autoProcess', 'profileId'])
    assert(typeof value.autoProcess === 'boolean' && typeof value.profileId === 'string', '档案设置格式无效')
    assert(!value.profileId || api.list().some(p => p.id === value.profileId), '请先在迭代页保存文字 API 模型配置')
    assert(!value.autoProcess || value.profileId, '开启自动整理前请选择模型')
    atomic(settingsFile, value)
    if (!value.autoProcess) for (const r of records().items) if (r.status === 'queued' && r.automatic) write({ ...r, status: 'pending', automatic: false })
    return value
  }
  function list() {
    init()
    const { items, damaged } = records()
    return { entries: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(r => ({ id: r.id, workflowId: r.source.workflowId, name: r.result?.name || WORKFLOW_NAMES[r.source.workflowId] + ' · 待整理', summary: r.result?.summary || '', status: r.status, error: r.error || '', createdAt: r.createdAt, trashed: !!r.trashed, model: r.result?.model || '' })), damagedCount: damaged.length, settings: settings() }
  }
  function wake() {
    if (!schedule || timer) return
    timer = setTimeout(() => { timer = null; void pump().catch(() => { /* Records remain recoverable on disk; the UI reports read errors. */ }) }, 300)
    timer.unref?.()
  }
  function ingest(raw) {
    init()
    const source = sourceOf(raw)
    const id = createHash('sha256').update(JSON.stringify([source.workflowId, source.artifact.prompt, source.artifact.params])).digest('hex')
    if (existsSync(idOf(id))) return { id, duplicate: true, status: read(id).status }
    const all = records()
    assert(all.items.length + all.damaged.length < 1000, '档案库已达 1000 条上限，停止新增，不会自动删除旧档案')
    const config = settings()
    const record = { id, source, createdAt: new Date().toISOString(), status: config.autoProcess ? 'queued' : 'pending', profileId: config.profileId, automatic: config.autoProcess, result: null, error: '', trashed: false }
    write(record); wake()
    return { id, duplicate: false, status: record.status }
  }
  function enqueue(id, profileId) {
    init()
    assert(api.list().some(p => p.id === profileId), '请选择有效文字 API 模型')
    const r = read(id)
    assert(!r.trashed && !['processing', 'queued'].includes(r.status), '档案已在处理或位于回收站')
    // 已整理产物不允许重复计费覆盖，避免丢失手工复核依据。
    assert(r.status !== 'ready', '这份档案已整理，无需重复调用')
    write({ ...r, status: 'queued', error: '', profileId, automatic: false }); wake()
    return read(id)
  }
  async function pump() {
    init()
    if (working) return
    const job = records().items.find(r => r.status === 'queued' && !r.trashed)
    if (!job) return
    if (api.isBusy()) { wake(); return }
    working = true
    try {
      write({ ...job, status: 'processing' })
      try {
        const parts = libraryParts(job.source)
        const result = await api.pack(job.profileId, { task: 'prompt-library', workflowId: job.source.workflowId, sourcePrompt: job.source.artifact.prompt, sourceParams: job.source.artifact.params, expectedParts: parts.map(p => ({ key: p.key })) }, LIBRARY_SCHEMA, v => validateLibrary(job.source, v), LIBRARY_RULES)
        write({ ...read(job.id), status: 'ready', result, error: '' })
      } catch (e) { write({ ...read(job.id), status: 'error', error: e instanceof Error ? e.message : '整理失败；原文已保留' }) }
    } finally { working = false; wake() }
  }
  function update(id, raw) {
    init(); exact(raw, ['trashed']); assert(typeof raw.trashed === 'boolean', '回收站状态无效')
    const r = read(id); assert(r.status !== 'processing', '正在整理，请完成后再移动档案')
    write({ ...r, trashed: raw.trashed, ...(r.status === 'queued' ? { status: 'pending', automatic: false } : {}) })
    return read(id)
  }
  function detail(id) { init(); return read(id) }
  function close() { if (timer) clearTimeout(timer); timer = null }
  return { list, settings, saveSettings, ingest, enqueue, detail, update, pump, close }
}

const library = createLibraryService()
export async function handleLibrary(req, res, url) {
  const reply = (status, value) => { if (!res.destroyed) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)) } }
  try {
    const route = url.pathname.slice('/api/library'.length)
    if (req.method === 'GET') return reply(200, route ? library.detail(route.slice(1)) : library.list())
    assert(['POST', 'PUT'].includes(req.method), '不支持的档案接口')
    const chunks = []; let size = 0
    for await (const c of req) { size += c.length; assert(size <= 250000, '档案请求过大'); chunks.push(c) }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (req.method === 'POST' && !route) return reply(200, library.ingest(body))
    if (req.method === 'PUT' && route === '/settings') return reply(200, library.saveSettings(body))
    if (req.method === 'POST' && /^\/[a-f0-9]{64}\/process$/.test(route)) { exact(body, ['profileId']); return reply(200, library.enqueue(route.split('/')[1], body.profileId)) }
    if (req.method === 'PUT') return reply(200, library.update(route.slice(1), body))
    throw new Error('未知档案接口')
  } catch (e) { reply(400, { error: { message: e instanceof Error ? e.message : '档案操作失败' } }) }
}
