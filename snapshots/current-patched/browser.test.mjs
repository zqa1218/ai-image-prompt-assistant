// Isolated integration test: actual patched bundle/server + local fake model + headless Chrome.
// No user profile, user keys, images or external model calls are used.
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { stepRanges } from './iteration-core.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const temp = mkdtempSync(path.join(os.tmpdir(), 'pw-iteration-browser-'))
const calls = [], errors = []
let replyMode = 'valid', chrome, app, ws, proxy, upstream
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const json = (res, body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const steps = '【第1步·背景与景别陈设】\n使用原始底图，保持人物不变，重建石阶。\n\n【第2步·身体互动特效】\n本步不使用参考图。用第1步输出图，只加蓝色电弧。\n\n【第3步·氛围层】\n用第2步输出图，保持人物与环境不变，添加薄雾。'
const artifacts = {
  refine: { prompt: '保留人物身份、肤质和服装。背景改为暖灰色，保持原有光向。', channel: 'Gemini' },
  recompose: { prompt: '【正面提示词】\nportrait, soft light\n\n【负面提示词】\nblur, artifacts', params: ['--ar 3:4'], channel: 'Midjourney' },
  'refine-steps': { prompt: steps, channel: 'Gemini' },
}
try {
  upstream = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c)
    const body = JSON.parse(Buffer.concat(chunks).toString()); calls.push(body)
    const input = JSON.parse(body.messages[1].content)
    const slow = replyMode === 'slow'
    const result = input.task === 'prompt-library' ? { name: '石阶电弧薄雾', summary: '石阶场景与电弧、薄雾的复用模板。', parts: input.expectedParts.map(p => ({ key: p.key, body: input.workflowId === 'recompose' ? 'stone courtyard, soft light, subtle mist --ar 3:4 --no blur' : p.key.startsWith('第2') ? '在当前人物手边加入蓝色电弧，适配原有姿势和接触点。' : p.key.startsWith('第3') ? '在场景中加入薄雾，不改变前两步物体。' : '重建石阶庭院，保持透视与光向一致。' })), warnings: ['复用时确认原有接触位置。'] } : input.selectedDirection ? {
      parts: input.expectedParts.map(p => ({ key: p.key, body: input.workflowId === 'recompose' ? (p.key === '负面提示词' ? 'blur, artifacts' : 'portrait, softer light') : input.targetId === '2' ? '本步不使用参考图。用第1步输出图，保留人物身份与动作，降低蓝色电弧强度。' : '保留人物身份与动作，只降低本步效果强度，保持其它区域不变。' })),
      params: input.workflowId === 'recompose' ? ['--ar 3:4'] : [], changes: ['降低强度'], warnings: [],
    } : { analysis: '仅调整要求的强度。', conflicts: [], directions: ['1', '2', '3'].map(id => ({ id, title: '修改方向' + id, changes: '降低强度' + id, expected: '更自然', risk: '效果较弱' })), recommendedId: '1' }
    const content = replyMode === 'invalid' ? 'invalid json' : JSON.stringify(result)
    if (slow) await delay(600)
    json(res, { choices: [{ finish_reason: 'stop', message: { content } }] })
  })
  const modelPort = await listen(upstream)
  const reservation = http.createServer(); const appPort = await listen(reservation); await new Promise(r => reservation.close(r))
  const env = { ...process.env, PW_API_PORT: String(appPort), PROMPT_WIZARD_DATA_DIR: path.join(temp, 'data'), PROMPT_WIZARD_BRIDGE_DIR: path.join(temp, 'bridge') }
  delete env.DEEPSEEK_API_KEY
  app = spawn(process.execPath, [path.join(root, 'work/server/index.mjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let appLogs = ''; app.stdout.on('data', c => { appLogs += c }); app.stderr.on('data', c => { appLogs += c })
  const appUrl = `http://127.0.0.1:${appPort}`
  for (let i = 0; ; i++) { try { if ((await fetch(appUrl + '/api/health')).ok) break } catch {} if (i > 100) throw Error('Server not ready: ' + appLogs); await delay(50) }
  async function api(route, body, method = 'PUT') { const r = await fetch(appUrl + route, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const d = await r.json(); assert.equal(r.status, 200, JSON.stringify(d)); return d }
  await api('/api/settings', { mode: 'api', baseUrl: `http://127.0.0.1:${modelPort}`, model: 'fake-only' })
  const profile = { id: '', name: '本地测试模型', baseUrl: `http://127.0.0.1:${modelPort}/v1`, model: 'fake-one', format: 'json_object', apiKey: '' }
  const one = await api('/api/iteration/settings', profile)
  const two = await api('/api/iteration/settings', { ...profile, name: '第二测试模型', model: 'fake-two' })
  proxy = http.createServer(async (req, res) => {
    try {
      if (req.url === '/assets/index-CsLE5G_q.js') {
        res.writeHead(200, { 'content-type': 'text/javascript' })
        return res.end(readFileSync(path.join(root, 'work/dist/assets/index-CsLE5G_q.js'), 'utf8') + '\nwindow.__PW_TEST__ = { store: cd, workflows: Cc };')
      }
      const chunks = []; for await (const c of req) chunks.push(c)
      const r = await fetch(appUrl + req.url, { method: req.method, headers: { 'content-type': req.headers['content-type'] || 'application/json' }, ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) })
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') }); res.end(Buffer.from(await r.arrayBuffer()))
    } catch (e) { res.writeHead(500); res.end(String(e)) }
  })
  const port = await listen(proxy)
  chrome = spawn(process.env.PW_TEST_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${path.join(temp, 'chrome')}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
  const endpoint = await new Promise((resolve, reject) => { let out = ''; const timer = setTimeout(() => reject(Error('Chrome launch timeout')), 20000); chrome.stderr.on('data', c => { out += c; const m = out.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (m) { clearTimeout(timer); resolve(m[1]) } }); chrome.on('error', reject) })
  const tabs = await (await fetch(endpoint.replace('ws:', 'http:').replace(/\/devtools\/browser\/.*/, '/json/list'))).json()
  ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl)
  await new Promise(r => ws.addEventListener('open', r, { once: true }))
  let nextId = 0; const pending = new Map()
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(Error(JSON.stringify(m.error))); else p.resolve(m.result) } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text + ': ' + (m.params.exceptionDetails.exception?.description || '')) })
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })) })
  const evaluate = async expression => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value }
  const until = async (expression, label = expression) => { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await delay(40) } throw Error('UI timeout: ' + label + '\n' + await evaluate('document.body.innerText')) }
  const button = (name, index = 0) => `[...document.querySelectorAll('button')].filter(x=>x.textContent===${JSON.stringify(name)})[${index}]`
  const click = (name, index = 0) => evaluate(`${button(name, index)}.click()`)
  const input = (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  await cdp('Runtime.enable'); await cdp('Page.enable')
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false })
  await cdp('Page.navigate', { url: `http://127.0.0.1:${port}` })
  await until('!!window.__PW_TEST__')
  const readArtifact = () => evaluate('__PW_TEST__.store.getState().artifact')
  // Presets are reachable before generating any prompt, without changing existing profiles.
  await click('设置')
  await until('document.body.innerText.includes("提示词迭代与档案库 · 文字模型预设")')
  await evaluate("[...document.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent.includes('文字 API 配置')).open=true")
  const choosePreset = id => evaluate(`(()=>{const s=[...document.querySelectorAll('label')].find(l=>l.textContent.startsWith('一键模型预设')).querySelector('select');s.value=${JSON.stringify(id)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  await choosePreset('deepseek-flash')
  await until(`[...document.querySelectorAll('input')].some(e=>e.value==='deepseek-flash')`)
  await evaluate("(()=>{const e=[...document.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent.includes('文字 API 配置')).querySelector('input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'dummy-not-saved');e.dispatchEvent(new Event('input',{bubbles:true}));})()")
  await choosePreset('minimax-cn')
  await until(`[...document.querySelectorAll('input')].some(e=>e.value==='MiniMax-M3.1-Flash')`)
  assert.equal(await evaluate("[...document.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent.includes('文字 API 配置')).querySelector('input[type=password]').value"), '')
  assert.ok(await evaluate("!!document.querySelector('input[value=\"https://api.minimaxi.com/v1\"]')"))
  await choosePreset('minimax-global'); await until(`[...document.querySelectorAll('input')].some(e=>e.value==='https://api.minimax.io/v1')`)
  await choosePreset('deepseek-pro'); await until(`[...document.querySelectorAll('input')].some(e=>e.value==='deepseek-v4-pro')`)
  assert.equal(calls.length, 0)
  assert.equal((await (await fetch(appUrl + '/api/iteration/settings')).json()).profiles.length, 2)
  console.log('PASS preset settings access, four autofills, key clearing and no implicit saves/calls')
  await click('向导')
  async function setup(mode) {
    await evaluate(`(()=>{const {store,workflows}=__PW_TEST__; store.getState().start(${JSON.stringify(mode)});store.setState({stageIndex:workflows.find(w=>w.id===${JSON.stringify(mode)}).stages.findIndex(s=>s.id==='iterate'),artifact:${JSON.stringify(artifacts[mode])},records:{analyze:{status:'ready',output:'测试分析'},compose:{status:'ready',output:${JSON.stringify(artifacts[mode])}}}});})()`)
    await until(`document.querySelectorAll('section textarea').length===${mode === 'refine-steps' ? 3 : 1} && [...document.querySelectorAll('select')].some(s=>s.value===${JSON.stringify(one.savedId)})`)
  }
  for (const mode of ['refine', 'recompose', 'refine-steps']) {
    await setup(mode)
    const count = mode === 'refine-steps' ? 3 : 1
    for (let i = 0; i < count; i++) {
      const textarea = `section:nth-child(${i + 1}) textarea`
      await input(textarea, '降低强度，保留其它内容')
      await click('分析要求并给出 3 个方向', i)
      await until('document.querySelectorAll("input[type=radio]").length===3')
      assert.equal(await evaluate(`${button('按选定方向生成新版')}.disabled`), true)
      await evaluate('document.querySelectorAll("input[type=radio]")[1].click()')
      await until(`!${button('按选定方向生成新版')}.disabled`)
      await until('localStorage.getItem("prompt-wizard.library-outbox.v1")==="[]"')
      const countBeforePreview = (await (await fetch(appUrl + '/api/library')).json()).entries.length
      await click('按选定方向生成新版')
      await until('document.body.innerText.includes("新版预览（尚未替换原文）")')
      assert.deepEqual(await readArtifact(), artifacts[mode], 'Preview must not overwrite artifact')
      const libraryBeforeApply = await (await fetch(appUrl + '/api/library')).json()
      assert.equal(libraryBeforeApply.entries.length, countBeforePreview, 'Unapproved preview must not be archived')
      assert.ok(libraryBeforeApply.entries.every(e => e.status === 'pending'), 'Automatic API processing is opt-in')
      if (mode === 'refine-steps' && i === 1) {
        const shot = await cdp('Page.captureScreenshot', { captureBeyondViewport: true }); writeFileSync(path.join(root, 'ui-test-preview.png'), Buffer.from(shot.data, 'base64'))
      }
      await click('确认采用新版')
      await until('document.body.innerText.includes("撤回上一次采用")')
      const updated = await readArtifact(); assert.notEqual(updated.prompt, artifacts[mode].prompt)
      if (mode === 'refine-steps') {
        const before = stepRanges(steps), after = stepRanges(updated.prompt)
        before.forEach((r, j) => { if (j !== i) assert.equal(steps.slice(r.start, r.end), updated.prompt.slice(after[j].start, after[j].end)) })
      }
      if (mode === 'recompose') assert.match(updated.prompt, /portrait, softer light --ar 3:4 --no blur, artifacts/)
      await click('撤回上一次采用（本页保留最近 10 版）')
      await until('document.querySelectorAll("input[type=radio]").length===0')
      assert.deepEqual(await readArtifact(), artifacts[mode])
      console.log('PASS UI analyze/select/preview/apply/undo: ' + mode + ' target ' + (i + 1))
    }
  }
  await setup('refine')
  await input('section textarea', '降低强度'); await click('分析要求并给出 3 个方向')
  await until('document.querySelectorAll("input[type=radio]").length===3')
  await evaluate(`(()=>{const s=[...document.querySelectorAll('select')].find(s=>s.parentElement.textContent.startsWith('本轮使用'));s.value=${JSON.stringify(two.savedId)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  await until('document.querySelectorAll("input[type=radio]").length===0')
  await input('section textarea', '降低强度'); await click('分析要求并给出 3 个方向')
  await until('document.querySelectorAll("input[type=radio]").length===3')
  assert.equal(calls.at(-1).model, 'fake-two')
  await input('section textarea', '改成更轻微的强度')
  await until('document.querySelectorAll("input[type=radio]").length===0')
  console.log('PASS UI model switch and requirement edit invalidate old analysis')
  replyMode = 'invalid'; const beforeInvalid = calls.length
  await click('分析要求并给出 3 个方向')
  await until('document.body.innerText.includes("两次未通过")')
  assert.equal(calls.length - beforeInvalid, 2); assert.deepEqual(await readArtifact(), artifacts.refine)
  console.log('PASS UI invalid JSON remains an error without overwriting')
  replyMode = 'slow'
  await click('分析要求并给出 3 个方向'); await until('document.body.innerText.includes("取消本次请求")'); await click('取消本次请求')
  await until('!__PW_TEST__.store.getState().busy'); await delay(750)
  assert.equal(await evaluate('document.querySelectorAll("input[type=radio]").length'), 0)
  assert.deepEqual(await readArtifact(), artifacts.refine)
  console.log('PASS UI cancel ignores late response')
  replyMode = 'valid'
  await click('分析要求并给出 3 个方向'); await until('document.querySelectorAll("input[type=radio]").length===3')
  await evaluate(`(()=>{const d=[...document.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent.includes('文字 API 配置'));d.open=true; const s=[...d.querySelectorAll('label')].find(l=>l.textContent.startsWith('编辑配置')).querySelector('select');s.value='';s.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  await until('document.querySelectorAll("input[type=radio]").length===0')
  const configInput = (label, value) => evaluate(`(()=>{const e=[...document.querySelectorAll('label')].find(e=>e.textContent===${JSON.stringify(label)}).querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`)
  await configInput('配置名称', '界面保存测试')
  await configInput('API 基础地址', `http://127.0.0.1:${modelPort}/v1`)
  await configInput('模型 ID', 'saved-from-ui')
  await click('保存配置')
  await until('[...document.querySelectorAll("option")].some(o=>o.textContent.includes("界面保存测试"))')
  const settings = await (await fetch(appUrl + '/api/iteration/settings')).json()
  assert.ok(settings.profiles.some(p=>p.model==='saved-from-ui'))
  console.log('PASS UI create and select independent model configuration')
  // All generated / adopted versions are captured even when the library page has never been opened.
  await until('localStorage.getItem("prompt-wizard.library-outbox.v1")==="[]"')
  let libraryList = await (await fetch(appUrl + '/api/library')).json()
  assert.ok(libraryList.entries.length >= 8)
  assert.equal(calls.filter(c => JSON.parse(c.messages[1].content).task === 'prompt-library').length, 0)
  const originalIds = {}
  for (const e of libraryList.entries) {
    const d = await (await fetch(appUrl + '/api/library/' + e.id)).json()
    if (d.source.artifact.prompt === artifacts[e.workflowId].prompt) originalIds[e.workflowId] = e.id
  }
  assert.equal(Object.keys(originalIds).length, 3)
  await click('档案库')
  await until('document.body.innerText.includes("可复用提示词档案库") && document.querySelectorAll("button[data-archive-id]").length>0')
  await evaluate(`(()=>{const s=[...document.querySelectorAll('label')].find(l=>l.textContent.startsWith('使用已保存的文字')).querySelector('select');s.value=${JSON.stringify(one.savedId)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  await click('保存档案设置')
  await until('document.body.innerText.includes("档案设置已保存")')
  for (const mode of ['refine', 'recompose', 'refine-steps']) {
    const id = originalIds[mode]
    await evaluate(`document.querySelector('button[data-archive-id="${id}"]').click()`)
    await until('document.body.innerText.includes("使用所选 API 整理并命名")')
    await click('使用所选 API 整理并命名')
    await until(`document.querySelectorAll('article textarea').length===${mode === 'refine-steps' ? 3 : 1}`)
    const d = await (await fetch(appUrl + '/api/library/' + id)).json()
    assert.equal(d.source.artifact.prompt, artifacts[mode].prompt)
    assert.equal(d.result.parts.length, mode === 'refine-steps' ? 3 : 1)
    assert.ok(d.result.parts.every(p=>p.body.includes(mode === 'recompose' ? 'garment style and all clothing details' : '衣服样式及细节不变')))
    console.log('PASS library UI grouped processing: ' + mode)
  }
  // Stub only the OS clipboard boundary: do not overwrite the user's actual clipboard.
  await evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('fixture clipboard unavailable')}}})")
  await click('复制第 2 步'); await until('document.body.innerText.includes("剪贴板不可用")')
  await evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__testClipboard=text}}})")
  await click('复制第 2 步'); await until('document.body.innerText.includes("已复制")')
  const copied = await evaluate('window.__testClipboard')
  assert.ok(copied.includes('使用第1步输出图')); assert.ok(!copied.includes('重建石阶庭院'))
  console.log('PASS library copy only requested step')
  await click('移入回收站')
  await until('document.body.innerText.includes("恢复档案")')
  await click('恢复档案'); await until('document.body.innerText.includes("移入回收站")')
  assert.equal((await (await fetch(appUrl + '/api/library/' + originalIds['refine-steps'])).json()).trashed, false)
  // Enable API processing once, then produce a new approved artifact while still on the library tab.
  await evaluate("[...document.querySelectorAll('label')].find(l=>l.textContent.includes('新档案自动调用')).querySelector('input').click()")
  await click('保存档案设置'); await until('document.body.innerText.includes("档案设置已保存")')
  const autoPrompt = '保持原有人物，场景加入石灯和薄雾。'
  await evaluate(`(()=>{const s=__PW_TEST__.store;s.setState({workflowId:'refine',artifact:{prompt:${JSON.stringify(autoPrompt)},channel:'test'},records:{compose:{status:'ready'}},busy:false});})()`)
  await until('localStorage.getItem("prompt-wizard.library-outbox.v1")==="[]"')
  await until(`fetch('/api/library').then(r=>r.json()).then(d=>d.entries.filter(e=>e.status==='ready').length>=4)`)
  const afterAuto = await (await fetch(appUrl + '/api/library')).json()
  const callsAfterAuto = calls.length
  await evaluate(`__PW_TEST__.store.setState({artifact:{prompt:${JSON.stringify(autoPrompt)},channel:'test'}})`)
  await delay(800)
  assert.equal(calls.length, callsAfterAuto, 'Duplicate artifact must not be charged again')
  const shot = await cdp('Page.captureScreenshot', { captureBeyondViewport: true }); writeFileSync(path.join(root, 'library-ui-test.png'), Buffer.from(shot.data, 'base64'))
  console.log('PASS library automatic packing, deduplication and recoverable trash')
  // Refresh verifies persisted records, not in-memory React state.
  await cdp('Page.reload'); await until('!!window.__PW_TEST__')
  await click('档案库'); await until(`document.querySelectorAll('button[data-archive-id]').length===${afterAuto.entries.length}`)
  console.log('PASS library persists across page reload')
  assert.deepEqual(errors, [])
  assert.ok(calls.every(c => !JSON.stringify(c).includes('data:image/')))
  console.log('PASS browser runtime: no unhandled errors; ' + calls.length + ' mocked model calls')
} finally {
  ws?.close(); chrome?.kill(); app?.kill()
  proxy?.closeAllConnections(); proxy?.close()
  upstream?.closeAllConnections(); upstream?.close()
}
