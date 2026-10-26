const { entrypoints, storage } = require('uxp')
const { app, core, imaging } = require('photoshop')
const os = require('os')
const PLUGIN_VERSION = '0.1.1'

let socket = null
let retryTimer = null
let connectionTimer = null

entrypoints.setup({
  panels: {
    promptWizardLink: {
      create() { setTimeout(connect, 100) },
    },
  },
})

// loadEvent=startup 时即连接，不等用户打开面板。
setTimeout(connect, 100)

async function connect() {
  clearTimeout(retryTimer)
  if (socket && (socket.readyState === 0 || socket.readyState === 1)) return
  const endpoint = await readEndpoint()
  if (!endpoint) return retry('请先启动桌面应用')
  try {
    console.log(`[PromptWizard] 正在连接 ws://${endpoint.host}:${endpoint.port}`)
    const candidate = new WebSocket(`ws://${endpoint.host}:${endpoint.port}/ps-bridge?token=${encodeURIComponent(endpoint.token)}`)
    socket = candidate
    clearTimeout(connectionTimer)
    connectionTimer = setTimeout(() => {
      if (socket !== candidate || candidate.readyState === WebSocket.OPEN) return
      try { candidate.close() } catch {}
      socket = null
      retry('连接超时，正在重试…')
    }, 4000)
    candidate.onopen = () => {
      clearTimeout(connectionTimer)
      console.log('[PromptWizard] 已连接桌面应用')
      candidate.send(JSON.stringify({ type: 'pluginHello', version: PLUGIN_VERSION }))
      setStatus('已连接桌面应用', true)
    }
    candidate.onmessage = (event) => { void receive(event.data) }
    candidate.onerror = (error) => {
      console.error('[PromptWizard] WebSocket 连接错误', error)
      candidate.close()
    }
    candidate.onclose = () => {
      if (socket !== candidate) return
      clearTimeout(connectionTimer)
      socket = null
      console.warn('[PromptWizard] 连接已断开，正在重试')
      retry('连接已断开，正在重试…')
    }
  } catch {
    retry('无法连接，正在重试…')
  }
}

async function receive(raw) {
  let message
  try { message = JSON.parse(raw) } catch { return }
  if (message?.type !== 'capture') return
  try {
    const image = await captureActiveDocument(message.role)
    send({ type: 'captureResult', id: message.id, image })
  } catch (error) {
    send({ type: 'captureResult', id: message.id, error: error?.message || String(error) })
  }
}

function pixelNumber(value) {
  if (typeof value === 'number') return value
  if (value && typeof value === 'object') {
    if (typeof value.as === 'function') {
      try { return Number(value.as('px')) } catch {}
    }
    if (typeof value._value === 'number') return value._value
    if (typeof value.value === 'number') return value.value
  }
  return Number(value)
}

function captureRegion(doc) {
  const canvasWidth = Math.max(1, Math.round(pixelNumber(doc.width)))
  const canvasHeight = Math.max(1, Math.round(pixelNumber(doc.height)))
  let raw = null
  try { raw = doc.selection?.bounds } catch {}

  if (raw) {
    const left = Math.max(0, Math.round(pixelNumber(raw.left)))
    const top = Math.max(0, Math.round(pixelNumber(raw.top)))
    const right = Math.min(canvasWidth, Math.round(pixelNumber(raw.right)))
    const bottom = Math.min(canvasHeight, Math.round(pixelNumber(raw.bottom)))
    if ([left, top, right, bottom].every(Number.isFinite) && right > left && bottom > top) {
      return {
        hasSelection: true,
        bounds: { left, top, right, bottom },
        sourceBounds: { left, top, width: right - left, height: bottom - top },
        width: right - left,
        height: bottom - top,
      }
    }
  }

  return {
    hasSelection: false,
    bounds: null,
    sourceBounds: null,
    width: canvasWidth,
    height: canvasHeight,
  }
}

async function captureActiveDocument(role) {
  return core.executeAsModal(async () => {
    const doc = app.activeDocument
    if (!doc) throw new Error('请先在 Photoshop 中打开一个文档')
    const region = captureRegion(doc)
    const scale = Math.min(1, 1568 / Math.max(region.width, region.height))
    const targetSize = {
      width: Math.max(1, Math.round(region.width * scale)),
      height: Math.max(1, Math.round(region.height * scale)),
    }
    const options = {
      documentID: doc.id,
      targetSize,
      colorSpace: 'RGB',
      colorProfile: 'sRGB IEC61966-2.1',
      componentSize: 8,
      applyAlpha: true,
    }
    // Photoshop 存在有效选区时只读取选区外接框；无选区时保持原来的整画布读取。
    if (region.sourceBounds) options.sourceBounds = region.sourceBounds
    const result = await imaging.getPixels(options)
    try {
      const base64 = await imaging.encodeImageData({ imageData: result.imageData, base64: true })
      const bytes = Math.floor((base64.length * 3) / 4)
      const label = role === 'reference' ? '参考图' : '底图'
      return {
        name: `${doc.title || 'Photoshop'}-${label}${region.hasSelection ? '-选区' : ''}.jpg`,
        dataUrl: `data:image/jpeg;base64,${base64}`,
        width: result.imageData.width || targetSize.width,
        height: result.imageData.height || targetSize.height,
        bytes,
        sourceMime: 'image/jpeg',
        captureScope: region.hasSelection ? 'selection' : 'canvas',
        selectionBounds: region.bounds,
      }
    } finally {
      result.imageData.dispose()
    }
  }, { commandName: '从 Photoshop 导入图片', timeOut: 5000 })
}

async function readEndpoint() {
  try {
    const appData = join(os.homedir(), 'AppData', 'Roaming')
    const nativePath = join(appData, 'PromptWizard', 'bridge.json')
    const entry = await storage.localFileSystem.getEntryWithUrl(toFileUrl(nativePath))
    const text = await entry.read({ format: storage.formats.utf8 })
    const endpoint = JSON.parse(String(text))
    return endpoint?.port && endpoint?.token ? endpoint : null
  } catch (error) {
    console.error('[PromptWizard] 无法读取 bridge.json', error)
    return null
  }
}

function join(...parts) {
  return parts.filter(Boolean).join('\\').replace(/[\\/]+/g, '\\')
}

function toFileUrl(nativePath) {
  const normalized = String(nativePath).replace(/\\/g, '/')
  return /^[a-zA-Z]:\//.test(normalized) ? `file:///${normalized}` : `file://${normalized}`
}

function send(value) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value))
}

function retry(text) {
  setStatus(text, false)
  clearTimeout(retryTimer)
  retryTimer = setTimeout(connect, 2000)
}

function setStatus(text, online) {
  const node = document.getElementById('status')
  if (!node) return
  node.textContent = text
  node.className = online ? 'online' : ''
}
