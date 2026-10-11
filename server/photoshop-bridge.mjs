import crypto from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { WebSocketServer } from 'ws'

const token = crypto.randomBytes(24).toString('hex')
const pending = new Map()
let plugin = null

export async function attachPhotoshopBridge(server, port) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 30 * 1024 * 1024 })
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
    if (url.pathname !== '/ps-bridge' || url.searchParams.get('token') !== token) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws))
  })

  wss.on('connection', (ws) => {
    plugin?.close()
    plugin = ws
    ws.on('message', (raw) => receive(raw))
    ws.on('close', () => { if (plugin === ws) plugin = null })
    ws.on('error', () => { if (plugin === ws) plugin = null })
    ws.send(JSON.stringify({ type: 'hello', ok: true }))
  })

  const bridgeDir = process.env.PROMPT_WIZARD_BRIDGE_DIR ||
    path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'PromptWizard')
  await mkdir(bridgeDir, { recursive: true })
  await writeFile(
    path.join(bridgeDir, 'bridge.json'),
    `${JSON.stringify({ host: '127.0.0.1', port, token }, null, 2)}\n`,
    { mode: 0o600 },
  )
}

export function photoshopStatus() {
  return { connected: plugin?.readyState === 1 }
}

export function captureFromPhotoshop(role) {
  if (!photoshopStatus().connected) {
    throw new Error('未连接 Photoshop 插件，请先打开「AI修图提示词 Link」面板')
  }
  const id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('Photoshop 读取超时'))
    }, 30_000)
    pending.set(id, { resolve, reject, timer })
    plugin.send(JSON.stringify({ type: 'capture', id, role }))
  })
}

function receive(raw) {
  let message
  try { message = JSON.parse(raw.toString()) } catch { return }
  if (message?.type !== 'captureResult' || typeof message.id !== 'string') return
  const task = pending.get(message.id)
  if (!task) return
  clearTimeout(task.timer)
  pending.delete(message.id)
  if (message.error) task.reject(new Error(String(message.error)))
  else task.resolve(message.image)
}
