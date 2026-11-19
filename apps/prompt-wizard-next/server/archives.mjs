/**
 * 配置存档：把一份接收阶段配置（需求 + 底图 + 参考图）存到本机数据目录，
 * 下次一键载入，不用重新选图、重新勾需求。
 *
 * 存磁盘而不是 localStorage：一张 1568px 的 JPEG 压缩后仍有几百 KB，
 * 几份带图存档就会把 localStorage 的 5 MB 撑爆；数据目录本来就在本机，
 * 卸载时也按 deleteAppDataOnUninstall=false 保留。
 */
import path from 'node:path'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { DATA_DIR } from './config.mjs'

export const ARCHIVE_DIR = path.join(DATA_DIR, 'archives')
const INDEX_PATH = path.join(ARCHIVE_DIR, 'index.json')

/** 存档条数上限，避免数据目录无限膨胀。 */
export const MAX_ARCHIVES = 100
const MAX_NAME = 60
const MAX_REFERENCES = 12
/** 单张图片的 data URL 字符上限（约 12 MB 实际字节）。 */
const MAX_IMAGE_CHARS = 16 * 1024 * 1024
/** 一份存档里所有图片的实际字节上限。 */
const MAX_TOTAL_BYTES = 48 * 1024 * 1024
const MAX_THUMB_CHARS = 400 * 1024
const MAX_INTAKE_CHARS = 200 * 1024

const ID_PATTERN = /^[a-z0-9]{8,32}$/

/** 存档相关的可读错误，路由层按 400 返回。 */
export class ArchiveError extends Error {
  name = 'ArchiveError'
}

export function isValidArchiveId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value)
}

function fileOf(id) {
  return path.join(ARCHIVE_DIR, `${id}.json`)
}

function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function dataUrlBytes(dataUrl) {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return 0
  const base64 = dataUrl.slice(comma + 1)
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding)
}

function metaOf(record) {
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt ?? record.createdAt,
    workflowId: record.workflowId,
    imageCount: (record.original ? 1 : 0) + (record.references?.length ?? 0),
    hasOriginal: Boolean(record.original),
    bytes: record.bytes ?? 0,
    thumb: record.thumb ?? '',
  }
}

function writeIndex(metas) {
  mkdirSync(ARCHIVE_DIR, { recursive: true })
  writeFileSync(`${INDEX_PATH}.tmp`, JSON.stringify(metas), 'utf8')
  renameSync(`${INDEX_PATH}.tmp`, INDEX_PATH)
}

function readArchiveFile(id) {
  if (!isValidArchiveId(id)) return null
  const file = fileOf(id)
  if (!existsSync(file)) return null
  try {
    const record = JSON.parse(readFileSync(file, 'utf8'))
    return record && typeof record === 'object' ? record : null
  } catch {
    return null
  }
}

/** 索引缺失或损坏时按目录里的存档文件重建，保证存档列表不会因为一个坏文件消失。 */
function rebuildIndex() {
  if (!existsSync(ARCHIVE_DIR)) return []
  const metas = []
  for (const file of readdirSync(ARCHIVE_DIR)) {
    if (!file.endsWith('.json') || file === 'index.json') continue
    const record = readArchiveFile(file.slice(0, -'.json'.length))
    if (record) metas.push(metaOf(record))
  }
  writeIndex(metas)
  return metas
}

function indexMatchesFiles(metas) {
  if (!existsSync(ARCHIVE_DIR)) return metas.length === 0
  const indexed = new Set(metas.map((meta) => meta.id))
  const files = readdirSync(ARCHIVE_DIR)
    .filter((file) => file.endsWith('.json') && file !== 'index.json')
    .map((file) => file.slice(0, -'.json'.length))
    .filter(isValidArchiveId)
  return files.length === indexed.size && files.every((id) => indexed.has(id))
}

export function listArchives() {
  let metas = null
  if (existsSync(INDEX_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(INDEX_PATH, 'utf8'))
      if (Array.isArray(raw)) metas = raw.filter((item) => item && isValidArchiveId(item.id))
    } catch {
      metas = null
    }
  }
  if (!metas || !indexMatchesFiles(metas)) metas = rebuildIndex()
  return metas
    .slice()
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
}

export function readArchive(id) {
  return readArchiveFile(id)
}

export function saveArchive(input) {
  const normalized = normalizeArchive(input)
  mkdirSync(ARCHIVE_DIR, { recursive: true })
  const existing = normalized.id ? readArchiveFile(normalized.id) : null
  const metas = listArchives()
  if (!existing && metas.length >= MAX_ARCHIVES) {
    throw new ArchiveError(`存档最多 ${MAX_ARCHIVES} 份，请先删除一些再保存`)
  }

  const now = new Date().toISOString()
  const id = existing ? existing.id : newId()
  const record = {
    version: 1,
    id,
    name: normalized.name,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    workflowId: normalized.workflowId,
    intake: normalized.intake,
    original: normalized.original,
    references: normalized.references,
    bytes: normalized.bytes,
    thumb: normalized.thumb,
  }
  writeFileSync(`${fileOf(id)}.tmp`, JSON.stringify(record), 'utf8')
  renameSync(`${fileOf(id)}.tmp`, fileOf(id))
  writeIndex([...metas.filter((meta) => meta.id !== id), metaOf(record)])
  return metaOf(record)
}

export function deleteArchive(id) {
  if (!isValidArchiveId(id)) throw new ArchiveError('存档标识无效')
  const file = fileOf(id)
  if (!existsSync(file)) return false
  rmSync(file)
  writeIndex(listArchives().filter((meta) => meta.id !== id))
  return true
}

function normalizeArchive(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ArchiveError('存档内容必须是 JSON 对象')
  }
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name) throw new ArchiveError('请给存档起一个名字')
  if (name.length > MAX_NAME) throw new ArchiveError(`存档名不能超过 ${MAX_NAME} 个字`)

  const workflowId = typeof input.workflowId === 'string' ? input.workflowId.trim() : ''
  if (!workflowId || workflowId.length > 40) throw new ArchiveError('存档缺少有效的工作路径标识')

  const intake = normalizeIntake(input.intake)
  const original = input.original ? normalizeImage(input.original, '底图') : null
  const references = Array.isArray(input.references)
    ? input.references.map((item, index) => normalizeImage(item, `参考图${index + 1}`))
    : []
  if (references.length > MAX_REFERENCES) {
    throw new ArchiveError(`参考图最多 ${MAX_REFERENCES} 张`)
  }

  const images = [...(original ? [original] : []), ...references]
  const bytes = images.reduce((sum, image) => sum + dataUrlBytes(image.dataUrl), 0)
  if (bytes > MAX_TOTAL_BYTES) {
    throw new ArchiveError('图片总量超出单份存档上限，请减少图片或先压缩')
  }

  const thumb =
    typeof input.thumb === 'string' &&
    input.thumb.startsWith('data:image/') &&
    input.thumb.length <= MAX_THUMB_CHARS
      ? input.thumb
      : ''

  return {
    id: isValidArchiveId(input.id) ? input.id : '',
    name,
    workflowId,
    intake,
    original,
    references,
    bytes,
    thumb,
  }
}

function normalizeIntake(input) {
  if (input === undefined || input === null) return {}
  if (typeof input !== 'object' || Array.isArray(input)) throw new ArchiveError('需求字段格式无效')
  const intake = {}
  let total = 0
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'string' || !key || key.length > 60) continue
    total += key.length + value.length
    if (total > MAX_INTAKE_CHARS) throw new ArchiveError('需求内容过长，无法保存')
    intake[key] = value
  }
  return intake
}

function positive(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0
}

function normalizeBounds(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const bounds = {}
  for (const key of ['left', 'top', 'right', 'bottom']) {
    const value = Number(input[key])
    if (!Number.isFinite(value)) return null
    bounds[key] = value
  }
  return bounds
}

function normalizeImage(input, label) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ArchiveError(`${label}格式无效`)
  }
  const dataUrl = typeof input.dataUrl === 'string' ? input.dataUrl : ''
  if (!dataUrl.startsWith('data:image/') || !dataUrl.includes(',')) {
    throw new ArchiveError(`${label}不是可用的图片数据`)
  }
  if (dataUrl.length > MAX_IMAGE_CHARS) throw new ArchiveError(`${label}体积过大，请先压缩`)

  const image = {
    name: typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 120) : label,
    dataUrl,
    width: positive(input.width),
    height: positive(input.height),
    bytes: positive(input.bytes) || dataUrlBytes(dataUrl),
  }
  if (typeof input.note === 'string') {
    if (input.note.length > 12000) throw new ArchiveError(`${label}分工过长`)
    image.note = input.note
  }
  const originalBytes = positive(input.originalBytes)
  if (originalBytes) image.originalBytes = originalBytes
  if (typeof input.sourceMime === 'string' && input.sourceMime) {
    image.sourceMime = input.sourceMime.slice(0, 80)
  }
  if (input.captureScope === 'selection' || input.captureScope === 'canvas') {
    image.captureScope = input.captureScope
  }
  const bounds = normalizeBounds(input.selectionBounds)
  if (bounds) image.selectionBounds = bounds
  return image
}
