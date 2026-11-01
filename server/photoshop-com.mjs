import { execFile } from 'node:child_process'
import { readFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 免插件的 Photoshop 通道：直接用 Photoshop 自带的 COM 自动化，
 * 让 Photoshop 自己把当前画布导出成 JPEG 再交给助手。
 * 这样既不用开 UXP Developer Tools，也不用安装任何 UXP 插件。
 */
// 打包后本文件在 app.asar 里，但 PowerShell 读不到 asar，所以脚本走 asar.unpacked。
const here = path
  .dirname(fileURLToPath(import.meta.url))
  .replace('app.asar', 'app.asar.unpacked')
const CAPTURE_SCRIPT = path.join(here, 'photoshop-com-capture.ps1')
const POWERSHELL = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
)

const MESSAGES = {
  PS_NOT_FOUND: '没有找到正在运行的 Photoshop，请先打开 Photoshop',
  NO_DOCUMENT: 'Photoshop 里还没有打开任何文档，请先打开一张图',
  DOCUMENT_NOT_FOUND: '找不到选中的那张 Photoshop 文档，请重新选择',
  PS_NO_RESULT: 'Photoshop 没有返回结果，请确认 Photoshop 里没有等待确认的对话框',
  PS_RUN_FAILED: 'Photoshop 执行导出失败',
  EXPORT_MISSING: 'Photoshop 没有生成导出文件',
  JSX_MISSING: '缺少 photoshop-com-capture.jsx',
  TEMP_DIR_FAILED: '无法创建临时目录',
  PS_BAD_RESULT: 'Photoshop 返回了无法识别的结果',
}

let runningCache = { at: 0, value: false }

/** Photoshop 没启动时直接给结论，不要用 COM 把 Photoshop 拉起来。 */
export async function photoshopProcessRunning() {
  if (process.platform !== 'win32') return false
  const now = Date.now()
  if (now - runningCache.at < 2000) return runningCache.value
  const running = await new Promise((resolve) => {
    execFile(
      'tasklist',
      ['/FI', 'IMAGENAME eq Photoshop.exe', '/NH'],
      { windowsHide: true, timeout: 8000 },
      (error, stdout) => {
        if (error) return resolve(false)
        resolve(/photoshop\.exe/i.test(String(stdout)))
      },
    )
  })
  runningCache = { at: now, value: running }
  return running
}

function runPhotoshopScript(args) {
  return new Promise((resolve, reject) => {
    execFile(
      POWERSHELL,
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        CAPTURE_SCRIPT,
        ...args,
      ],
      { windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        const text = String(stdout ?? '').trim()
        const line = text.split(/\r?\n/).filter(Boolean).pop()
        if (line) {
          try {
            return resolve(JSON.parse(line))
          } catch {
            // 输出不是 JSON，落到末尾的错误分支
          }
        }
        if (error) return reject(new Error(error.message))
        reject(new Error(text || 'Photoshop 通道没有输出'))
      },
    )
  })
}

function describeFailure(result) {
  const code = result && typeof result.code === 'string' ? result.code : ''
  const known = code ? MESSAGES[code] : ''
  const detail = result && result.detail ? String(result.detail) : ''
  if (known) return new Error(detail ? known + '：' + detail : known)
  return new Error(detail || 'Photoshop 读取失败')
}

export async function listPhotoshopDocuments() {
  const result = await runPhotoshopScript(['-Action', 'list'])
  if (!result || !result.ok) throw describeFailure(result)
  return Array.isArray(result.documents) ? result.documents : []
}

export async function captureViaPhotoshopCom({ role = 'original', index = -1 } = {}) {
  const result = await runPhotoshopScript([
    '-Action',
    'capture',
    '-DocIndex',
    String(Number.isInteger(index) ? index : -1),
    '-MaxSize',
    '1568',
  ])
  if (!result || !result.ok) throw describeFailure(result)

  let buffer
  try {
    buffer = await readFile(result.path)
  } finally {
    await unlink(result.path).catch(() => {})
  }

  const label = role === 'reference' ? '参考图' : '底图'
  const hasSelection = result.hasSelection === true
  return {
    name: `${result.name || 'Photoshop'}-${label}${hasSelection ? '-选区' : ''}.jpg`,
    dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`,
    width: Number(result.width) || undefined,
    height: Number(result.height) || undefined,
    bytes: buffer.length,
    sourceMime: 'image/jpeg',
    captureScope: hasSelection ? 'selection' : 'canvas',
    selectionBounds: result.selectionBounds || null,
  }
}
