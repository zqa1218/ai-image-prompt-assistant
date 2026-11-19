import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export class WorkbenchIntegrationError extends Error {
  constructor(message, status = 503) { super(message); this.status = status }
}

export function connectorPath() {
  return process.env.MJ_STUDIO_CONNECTOR_FILE ?? path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'MJStudio', 'connector.json')
}

export async function sendToWorkbench(payload, { file = connectorPath(), fetchImpl = fetch } = {}) {
  if (!payload || !/^[A-Za-z0-9_-]{8,128}$/.test(payload.requestId ?? '') || !['mj_web', 'banana_api'].includes(payload.mode)) {
    throw new WorkbenchIntegrationError('发送内容缺少有效请求 ID 或任务通道', 400)
  }
  let connector
  try {
    const stat = fs.statSync(file)
    if (stat.size > 8192) throw new Error('descriptor too large')
    connector = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    throw new WorkbenchIntegrationError('未发现正在运行的 MJ Studio，请先运行 npm run studio')
  }
  let target
  try { target = new URL('/api/integrations/prompt-wizard/tasks', connector.url) } catch { throw new WorkbenchIntegrationError('MJ Studio 连接文件已损坏，请重启工作台') }
  if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(target.hostname) || target.username || target.password || typeof connector.token !== 'string' || connector.token.length < 32) {
    throw new WorkbenchIntegrationError('拒绝不安全的 MJ Studio 连接目标')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  let response, body
  try {
    response = await fetchImpl(target, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', 'x-workbench-integration': connector.token, 'idempotency-key': payload.requestId },
      body: JSON.stringify({ artifact: payload.artifact, exchange: payload.exchange, mode: payload.mode }),
      signal: controller.signal,
    })
    body = await response.json().catch(() => null)
  } catch {
    throw new WorkbenchIntegrationError('无法连接 MJ Studio，请确认工作台仍在运行')
  } finally { clearTimeout(timer) }
  if (!response.ok) throw new WorkbenchIntegrationError(body?.error?.message || `MJ Studio 拒绝请求（${response.status}）`, response.status)
  if (!body?.task) throw new WorkbenchIntegrationError('工作台响应不完整，请保留输入后重试')
  return body
}
