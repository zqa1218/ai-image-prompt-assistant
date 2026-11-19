import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { PhotoshopBridge } from '../../../packages/photoshop/bridge.mjs'

let bridge = null

export async function attachPhotoshopBridge(server, port) {
  const bridgeDir = process.env.PROMPT_WIZARD_BRIDGE_DIR ||
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.workbench/prompt-wizard-next/bridge')
  bridge = new PhotoshopBridge({ descriptorFile: path.join(bridgeDir, 'bridge.json') }).attach(server, port)
  return bridge
}

export function photoshopBridgeInstance() {
  return bridge
}

export function photoshopStatus() {
  return bridge?.status() ?? { connected: false, mode: 'none', capabilities: [] }
}

export function listDocumentsFromPhotoshop() {
  if (!bridge) throw new Error('Photoshop 桥尚未启动')
  return bridge.listDocuments()
}

export function captureFromPhotoshop({ role = 'original', documentId, maxSize = 1568 } = {}) {
  if (!bridge) throw new Error('Photoshop 桥尚未启动')
  return bridge.capture({ role, documentId, scope: 'auto', maxSize })
}

export function placeInPhotoshop(request) {
  if (!bridge) throw new Error('Photoshop 桥尚未启动')
  return bridge.place(request)
}
