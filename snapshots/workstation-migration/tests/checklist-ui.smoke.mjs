import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

const root = path.resolve(import.meta.dirname, '..')
const temporary = mkdtempSync(path.join(os.tmpdir(), 'pw-checklist-ui-'))
let server, chrome, ws
try {
  server = await createServer({ root, server: { host: '127.0.0.1', port: 0, open: false }, plugins: [{ name: 'isolated-api', configureServer(s) {
    s.middlewares.use((req, res, next) => {
      if (!req.url.startsWith('/api/')) return next()
      const value = req.url === '/api/settings' ? { mode: 'api', baseUrl: 'https://example.invalid', model: 'mock', hasKey: false, plans: [], chatgptPlans: [] }
        : req.url.startsWith('/api/iteration/settings') ? { profiles: [], presets: [] }
        : req.url.startsWith('/api/library') ? { entries: [], settings: { automatic: false } } : {}
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value))
    })
  } }] })
  await server.listen()
  const url = server.resolvedUrls.local[0]
  chrome = spawn(process.env.PW_TEST_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${temporary}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Chrome timeout')), 20000)
    let output = ''
    chrome.stderr.on('data', chunk => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]) } })
    chrome.on('error', reject)
  })
  const tabs = await (await fetch(endpoint.replace('ws:', 'http:').replace(/\/devtools\/browser\/.*/, '/json/list'))).json()
  ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map(), errors = []
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id) { const p = pending.get(message.id); pending.delete(message.id); message.error ? p.reject(Error(JSON.stringify(message.error))) : p.resolve(message.result) }
    else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text)
  })
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); ws.send(JSON.stringify({ id: key, method, params })) })
  const evaluate = async expression => {
    const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result.value
  }
  const until = async expression => { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(50) } throw Error('Timed out: ' + expression) }
  const click = label => evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`)
  await cdp('Runtime.enable')
  await cdp('Page.navigate', { url })
  await until('document.body.innerText.includes("提示词向导")')
  await evaluate(`(async()=>{
    const m=await import('/src/lib/wizardStore.ts'); window.testStore=m.useWizard;
    m.setProvider({...m.MOCK_PROVIDER,askChecklist:async()=>JSON.stringify({items:[{q:'岩石大小',why:'影响遮挡',options:[{label:'小',note:'不挡脚部'},{label:'大',note:'突出主体'}],recommended:0}]})});
    testStore.getState().start('refine');testStore.getState().setIntake('taskType','置入物体');testStore.setState({stageIndex:3});
  })()`)
  await until('document.body.innerText.includes("置入物体 · 待定项")')
  await click('列出待定项')
  await until('document.querySelectorAll("input[type=radio]").length===2')
  assert.equal(await evaluate('document.querySelectorAll("input[type=radio]:checked").length'), 0)
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='写入补充要求').disabled`), true)
  await evaluate('document.querySelector("input[type=radio]").focus()')
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 })
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 })
  await until('document.querySelectorAll("input[type=radio]:checked").length===1')
  await click('写入补充要求')
  await until('testStore.getState().notes.length===1')
  assert.match(await evaluate('testStore.getState().notes[0]'), /小（不挡脚部）/)
  await click('列出待定项')
  await until('document.querySelectorAll("input[type=radio]").length===2')
  await click('选中全部推荐项')
  await click('重新抓取')
  await until('document.querySelectorAll("input[type=radio]").length===2 && document.querySelectorAll("input[type=radio]:checked").length===0')
  assert.deepEqual(errors, [])
  console.log('PASS checklist UI: explicit selection, keyboard selection, confirmed notes, refresh clears choices, no uncaught errors; isolated API only')
} finally {
  ws?.close()
  chrome?.kill()
  await server?.close()
}
