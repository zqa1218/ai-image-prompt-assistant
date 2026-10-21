/**
 * 借桥接用的 Chrome 当浏览器把页面打开，读 innerText。
 * 用法：node cdp-fetch.mjs <url> [最多字符数]
 */
import { readFileSync } from 'node:fs'

const [, , url, maxArg] = process.argv
const max = Number(maxArg ?? 8000)
let port = Number(process.env.CDP_PORT || 0)
if (!port) {
  const info = JSON.parse(readFileSync(`${process.env.APPDATA}/PromptWizard/gemini-browser/promptwizard-cdp.json`, 'utf8'))
  port = info.port
}
const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()

const ws = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', () => j(new Error('ws fail')), { once: true }) })

let seq = 0
const pending = new Map()
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })) })

const created = await send('Target.createTarget', { url })
const targetId = created.result?.targetId
if (!targetId) { console.log('createTarget failed', JSON.stringify(created)); process.exit(1) }

const attached = await send('Target.attachToTarget', { targetId, flatten: true })
const sessionId = attached.result?.sessionId
const cmd = (method, params = {}) => send(method, { ...params, sessionId })

await cmd('Page.enable')
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
for (let i = 0; i < 20; i += 1) {
  await delay(1000)
  const ready = await cmd('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true })
  const state = ready.result?.result?.value
  if (state === 'complete') break
}
await delay(Number(process.env.CDP_WAIT || 4000))

const out = await cmd('Runtime.evaluate', {
  expression: '(() => JSON.stringify({ url: location.href, title: document.title, len: (document.body ? document.body.innerText : "").length, text: document.body ? document.body.innerText : "" }))()',
  returnByValue: true,
})
const payload = JSON.parse(String(out.result?.result?.value ?? '{}'))
console.log(`[${payload.url}] ${payload.title} · ${payload.len} 字`)
console.log(String(payload.text || '').slice(0, max))
await send('Target.closeTarget', { targetId })
ws.close()
