const { entrypoints, storage } = require('uxp')
const { app, core, imaging, action, constants } = require('photoshop')
const os = require('os')

const PLUGIN_VERSION = '0.2.0'
const SESSION_ID = `ps_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
const CAPABILITIES = ['documents', 'capture', 'place']
const responseCache = new Map()

let socket = null
let retryTimer = null
let connectionTimer = null
let placeQueue = Promise.resolve()
let endpointOffset = 0

entrypoints.setup({ panels: { mjStudioCandidateLink: { create() { setTimeout(connect, 100) } } } })
setTimeout(connect, 100)

async function connect() {
  clearTimeout(retryTimer)
  if (socket && (socket.readyState === 0 || socket.readyState === 1)) return
  const endpoint = await readEndpoint()
  if (!endpoint) return retry('请先启动桌面应用')
  try {
    const pathname = typeof endpoint.pathname === 'string' ? endpoint.pathname : '/ps-bridge'
    const candidate = new WebSocket(`ws://${endpoint.host}:${endpoint.port}${pathname}?token=${encodeURIComponent(endpoint.token)}`)
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
      candidate.send(JSON.stringify({ type: 'pluginHello', version: PLUGIN_VERSION, sessionId: SESSION_ID, capabilities: CAPABILITIES }))
      setStatus('已连接桌面应用 · 安全回传已启用', true)
    }
    candidate.onmessage = event => { void receive(event.data) }
    candidate.onerror = () => candidate.close()
    candidate.onclose = () => {
      if (socket !== candidate) return
      clearTimeout(connectionTimer); socket = null; endpointOffset += 1; retry('连接已断开，正在重试…')
    }
  } catch { retry('无法连接，正在重试…') }
}

async function receive(raw) {
  let message
  try { message = JSON.parse(raw) } catch { return }
  if (message?.type !== 'request' || typeof message.requestId !== 'string') return
  if (message.sessionId !== SESSION_ID) return respond(message.requestId, false, null, { code: 'PS_SESSION_CHANGED', message: 'Photoshop 会话标识不匹配' })
  const signature = JSON.stringify([message.operation, message.payload])
  const cached = responseCache.get(message.requestId)
  if (cached) {
    if (cached.signature !== signature) return respond(message.requestId, false, null, { code: 'PS_REQUEST_CONFLICT', message: '同一请求标识对应了不同操作' })
    return send(cached.response)
  }
  const execute = async () => {
    try {
      let result
      if (message.operation === 'documents') result = listDocuments()
      else if (message.operation === 'capture') result = await captureDocument(message.payload)
      else if (message.operation === 'place') result = await placeResult(message.payload)
      else throw coded('PS_CAPABILITY_UNAVAILABLE', `不支持 ${message.operation}`)
      return remember(message.requestId, signature, { type: 'response', requestId: message.requestId, sessionId: SESSION_ID, ok: true, result })
    } catch (error) {
      return remember(message.requestId, signature, { type: 'response', requestId: message.requestId, sessionId: SESSION_ID, ok: false, error: { code: error?.code || 'PS_OPERATION_FAILED', message: error?.message || String(error) } })
    }
  }
  if (message.operation === 'place') {
    const pending = placeQueue.then(execute, execute)
    placeQueue = pending.catch(() => {})
    await pending
  } else await execute()
}

function remember(requestId, signature, response) {
  responseCache.set(requestId, { signature, response })
  while (responseCache.size > 64) responseCache.delete(responseCache.keys().next().value)
  send(response)
}

function respond(requestId, ok, result, error) {
  send({ type: 'response', requestId, sessionId: SESSION_ID, ok, result, error })
}

function coded(code, message) { const error = new Error(message); error.code = code; return error }

function pixelNumber(value) {
  if (typeof value === 'number') return value
  if (value && typeof value === 'object') {
    if (typeof value.as === 'function') { try { return Number(value.as('px')) } catch {} }
    if (typeof value._value === 'number') return value._value
    if (typeof value.value === 'number') return value.value
  }
  return Number(value)
}

function selectionBounds(doc) {
  let raw = null
  try { raw = doc.selection?.bounds } catch {}
  if (!raw) return null
  const canvasWidth = Math.max(1, Math.round(pixelNumber(doc.width)))
  const canvasHeight = Math.max(1, Math.round(pixelNumber(doc.height)))
  const left = Math.max(0, Math.round(pixelNumber(raw.left)))
  const top = Math.max(0, Math.round(pixelNumber(raw.top)))
  const right = Math.min(canvasWidth, Math.round(pixelNumber(raw.right)))
  const bottom = Math.min(canvasHeight, Math.round(pixelNumber(raw.bottom)))
  return [left, top, right, bottom].every(Number.isFinite) && right > left && bottom > top ? { left, top, right, bottom } : null
}

function snapshot(doc) {
  return {
    sessionId: SESSION_ID,
    documentId: doc.id,
    documentName: doc.title || 'Photoshop',
    canvasWidth: Math.max(1, Math.round(pixelNumber(doc.width))),
    canvasHeight: Math.max(1, Math.round(pixelNumber(doc.height))),
    selectionBounds: selectionBounds(doc),
    selectionIsSolid: (() => { try { return doc.selection?.solid === true } catch { return false } })(),
    isActive: app.activeDocument?.id === doc.id,
    layers: doc.layers?.length || 0,
  }
}

function listDocuments() { return [...app.documents].map(snapshot) }

function findDocument(documentId) {
  if (!Number.isSafeInteger(documentId) || documentId < 1) throw coded('PS_DOCUMENT_REQUIRED', '请选择明确的 Photoshop 文档')
  const doc = [...app.documents].find(item => item.id === documentId)
  if (!doc) throw coded('PS_DOCUMENT_CHANGED', '原 Photoshop 文档已关闭或目标已改变')
  return doc
}

function capturePlan(doc, payload) {
  const current = snapshot(doc)
  const scope = payload?.scope === 'canvas' ? 'canvas' : current.selectionBounds ? 'selection' : 'canvas'
  const bounds = scope === 'selection' ? current.selectionBounds : { left: 0, top: 0, right: current.canvasWidth, bottom: current.canvasHeight }
  const sourceWidth = bounds.right - bounds.left
  const sourceHeight = bounds.bottom - bounds.top
  const maxSize = Number.isSafeInteger(payload?.maxSize) && payload.maxSize >= 64 && payload.maxSize <= 8192 ? payload.maxSize : 1568
  const scale = Math.min(1, maxSize / Math.max(sourceWidth, sourceHeight))
  return {
    current, captureScope: scope, sourceBounds: bounds, sourceWidth, sourceHeight,
    targetSize: { width: Math.max(1, Math.round(sourceWidth * scale)), height: Math.max(1, Math.round(sourceHeight * scale)) },
  }
}

async function captureDocument(payload) {
  return core.executeAsModal(async () => {
    const doc = findDocument(payload?.documentId)
    const plan = capturePlan(doc, payload)
    const pixels = await imaging.getPixels({
      documentID: doc.id,
      sourceBounds: { left: plan.sourceBounds.left, top: plan.sourceBounds.top, right: plan.sourceBounds.right, bottom: plan.sourceBounds.bottom },
      targetSize: plan.targetSize,
      colorSpace: 'RGB', colorProfile: 'sRGB IEC61966-2.1', componentSize: 8, applyAlpha: true,
    })
    let selectionMaskDataUrl = null
    try {
      const base64 = await imaging.encodeImageData({ imageData: pixels.imageData, base64: true })
      if (plan.captureScope === 'selection') selectionMaskDataUrl = await encodeSelectionMask(doc.id, plan)
      const bytes = Math.floor((base64.length * 3) / 4)
      const label = payload?.role === 'reference' ? '参考图' : '底图'
      return {
        name: `${plan.current.documentName.replace(/\.[^.]+$/, '')}-${label}${plan.captureScope === 'selection' ? '-选区' : ''}.jpg`,
        dataUrl: `data:image/jpeg;base64,${base64}`,
        width: pixels.imageData.width || plan.targetSize.width,
        height: pixels.imageData.height || plan.targetSize.height,
        bytes, sourceMime: 'image/jpeg', captureScope: plan.captureScope,
        selectionBounds: plan.captureScope === 'selection' ? plan.current.selectionBounds : null,
        selectionMaskDataUrl,
        photoshopSessionId: SESSION_ID,
        documentId: plan.current.documentId,
        documentName: plan.current.documentName,
        canvasWidth: plan.current.canvasWidth,
        canvasHeight: plan.current.canvasHeight,
      }
    } finally { pixels.imageData.dispose() }
  }, { commandName: '从 Photoshop 导入图片', timeOut: 5000 })
}

async function encodeSelectionMask(documentId, plan) {
  const selection = await imaging.getSelection({ documentID: documentId, sourceBounds: plan.sourceBounds, targetSize: plan.targetSize })
  try {
    const raw = await selection.imageData.getData()
    const gray = raw instanceof Uint8Array ? raw : new Uint8Array(raw)
    const rgb = new Uint8Array(gray.length * 3)
    for (let index = 0; index < gray.length; index += 1) rgb.set([gray[index], gray[index], gray[index]], index * 3)
    const width = selection.imageData.width || plan.targetSize.width
    const height = selection.imageData.height || plan.targetSize.height
    if (gray.length !== width * height) throw coded('PS_MASK_INVALID', 'Photoshop selection mask 像素尺寸不一致')
    const imageData = await imaging.createImageDataFromBuffer(rgb.buffer, { width, height, components: 3, colorSpace: 'RGB', colorProfile: 'sRGB IEC61966-2.1', componentSize: 8, chunky: true })
    try { return `data:image/jpeg;base64,${await imaging.encodeImageData({ imageData, base64: true })}` }
    finally { imageData.dispose() }
  } finally { selection.imageData.dispose() }
}

function assertTarget(expected, actual, placement) {
  if (!expected || expected.sessionId !== SESSION_ID) throw coded('PS_SESSION_CHANGED', 'Photoshop 已重新启动或插件已重连')
  if (expected.documentId !== actual.documentId) throw coded('PS_DOCUMENT_CHANGED', '原 Photoshop 文档已关闭或目标已改变')
  if (expected.documentName !== actual.documentName) throw coded('PS_DOCUMENT_RENAMED', 'Photoshop 文档名称已变化')
  if (expected.canvasWidth !== actual.canvasWidth || expected.canvasHeight !== actual.canvasHeight) throw coded('PS_CANVAS_CHANGED', 'Photoshop 画布尺寸已变化')
  if (placement === 'fit_selection' && JSON.stringify(expected.selectionBounds) !== JSON.stringify(actual.selectionBounds)) throw coded('PS_SELECTION_CHANGED', 'Photoshop 选区已变化')
}

function placementRect(sourceWidth, sourceHeight, placement, context) {
  if (placement === 'new_document') return { left: 0, top: 0, width: sourceWidth, height: sourceHeight }
  const bounds = placement === 'fit_selection' ? context.selectionBounds : { left: 0, top: 0, right: context.canvasWidth, bottom: context.canvasHeight }
  if (!bounds) throw coded('PS_SELECTION_REQUIRED', '回传到选区需要原选区')
  const targetWidth = bounds.right - bounds.left, targetHeight = bounds.bottom - bounds.top
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight)
  const width = sourceWidth * scale, height = sourceHeight * scale
  return { left: bounds.left + (targetWidth - width) / 2, top: bounds.top + (targetHeight - height) / 2, width, height }
}

async function placeResult(payload) {
  if (!['fit_canvas', 'fit_selection', 'new_document'].includes(payload?.placement)) throw coded('PS_PLACEMENT_INVALID', 'Photoshop 回传方式无效')
  if (!/^data:image\/(?:png|jpeg|webp);base64,/.test(payload?.dataUrl || '')) throw coded('PS_IMAGE_INVALID', '回传图片格式无效')
  const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(payload.dataUrl)
  const bytes = base64Bytes(match[2])
  if (bytes.byteLength > 30 * 1024 * 1024) throw coded('PS_IMAGE_INVALID', '回传图片超过 30 MiB')
  const folder = await storage.localFileSystem.getTemporaryFolder()
  const file = await folder.createFile(`prompt-wizard-${payload.requestId}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`, { overwrite: true })
  await file.write(bytes.buffer, { format: storage.formats.binary })
  try {
    return await core.executeAsModal(async executionContext => {
      let target
      if (payload.placement === 'new_document') target = await app.createDocument({ width: payload.sourceWidth, height: payload.sourceHeight, name: payload.layerName || '生成结果' })
      else {
        target = findDocument(payload.context?.documentId)
        assertTarget(payload.context, snapshot(target), payload.placement)
      }
      app.activeDocument = target
      const suspension = await executionContext.hostControl.suspendHistory({ documentID: target.id, name: '置入 AI 生成结果' })
      try {
        const token = storage.localFileSystem.createSessionToken(file)
        const result = await action.batchPlay([{ _obj: 'placeEvent', null: { _path: token, _kind: 'local' }, freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' }, _options: { dialogOptions: 'dontDisplay' } }], {})
        if (result?.[0]?.message) throw coded('PS_PLACE_FAILED', result[0].message)
        const layer = target.activeLayers?.[0]
        if (!layer) throw coded('PS_PLACE_FAILED', 'Photoshop 没有返回新图层')
        const rect = placementRect(payload.sourceWidth, payload.sourceHeight, payload.placement, payload.context)
        const before = layer.boundsNoEffects || layer.bounds
        const currentWidth = pixelNumber(before.right) - pixelNumber(before.left)
        const currentHeight = pixelNumber(before.bottom) - pixelNumber(before.top)
        const percent = Math.min(rect.width / currentWidth, rect.height / currentHeight) * 100
        await layer.scale(percent, percent, constants.AnchorPosition.MIDDLECENTER)
        const after = layer.boundsNoEffects || layer.bounds
        const centerX = (pixelNumber(after.left) + pixelNumber(after.right)) / 2
        const centerY = (pixelNumber(after.top) + pixelNumber(after.bottom)) / 2
        await layer.translate(rect.left + rect.width / 2 - centerX, rect.top + rect.height / 2 - centerY)
        layer.name = payload.layerName || 'AI 生成结果'
        return { sessionId: SESSION_ID, documentId: target.id, documentName: target.title, layerId: layer.id, layerName: layer.name, placement: payload.placement, targetBounds: rect }
      } finally { await executionContext.hostControl.resumeHistory(suspension) }
    }, { commandName: '置入 AI 生成结果', timeOut: 5000 })
  } finally { try { await file.delete() } catch {} }
}

function base64Bytes(text) {
  const binary = atob(text)
  const output = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index)
  return output
}

async function readEndpoint() {
  try {
    const appData = join(os.homedir(), 'AppData', 'Roaming')
    const endpoints = []
    for (const nativePath of [join(appData, 'MJStudioCandidate', 'bridge.json'), join(appData, 'MJStudio', 'bridge.json'), join(appData, 'PromptWizard', 'bridge.json')]) {
      try {
        const entry = await storage.localFileSystem.getEntryWithUrl(toFileUrl(nativePath))
        const endpoint = JSON.parse(String(await entry.read({ format: storage.formats.utf8 })))
        if (endpoint?.host === '127.0.0.1' && endpoint?.port && endpoint?.token) endpoints.push(endpoint)
      } catch {}
    }
    return endpoints.length ? endpoints[endpointOffset % endpoints.length] : null
  } catch { return null }
}

function join(...parts) { return parts.filter(Boolean).join('\\').replace(/[\\/]+/g, '\\') }
function toFileUrl(nativePath) { const normalized = String(nativePath).replace(/\\/g, '/'); return /^[a-zA-Z]:\//.test(normalized) ? `file:///${normalized}` : `file://${normalized}` }
function send(value) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)) }
function retry(text) { setStatus(text, false); clearTimeout(retryTimer); retryTimer = setTimeout(connect, 2000) }
function setStatus(text, online) { const node = document.getElementById('status'); if (!node) return; node.textContent = text; node.className = online ? 'online' : '' }
