import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { assert, text, exact, targets, expectedParts, validateAnalysis, mergeRevision, modeRules, ANALYSIS_SCHEMA, REVISION_SCHEMA } from '../shared/iteration-core.mjs'
import { DATA_DIR } from './config.mjs'
import { officialRequestOptions } from '../shared/model-presets.mjs'

export function createIterationService({ dataDir = DATA_DIR, storage = () => globalThis.promptWizardSafeStorage, fetchImpl = fetch, now = Date.now } = {}) {
  const file = path.join(dataDir, 'iteration-models.json')
  const tickets = new Map()
  let active = false
  const read = () => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []
  const list = () => read().map(({ encryptedKey, ...p }) => ({ ...p, hasKey: Boolean(encryptedKey) }))
  function save(p) {
    assert(!active, '文字 API 正在回复，请结束后再保存配置')
    exact(p, ['id', 'name', 'baseUrl', 'model', 'format', 'apiKey'])
    text(p.name, 80); text(p.model, 200); text(p.baseUrl, 1000)
    assert(typeof p.id === 'string' && /^[a-zA-Z0-9-]{0,80}$/.test(p.id), '配置 ID 无效')
    assert(typeof p.apiKey === 'string' && p.apiKey.length <= 4096 && !/[\r\n]/.test(p.apiKey), 'Key 格式无效')
    assert(['json_schema', 'json_object', 'prompt'].includes(p.format), '未知结构化输出方式')
    const url = new URL(p.baseUrl)
    assert(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)), 'API 地址必须使用 HTTPS，本机服务除外')
    assert(!url.username && !url.password && !url.hash && !url.search, 'API 地址不能含认证信息、查询参数或片段')
    assert(!/\/chat\/completions\/?$/.test(url.pathname), '请填写 API 基础地址，不要带 /chat/completions')
    const profiles = read(), old = profiles.find(x => x.id === p.id)
    assert(old || !p.id, '配置已不存在，请新建配置')
    assert(old || profiles.length < 20, '最多保存 20 组配置')
    const baseUrl = url.href.replace(/\/+$/, '')
    assert(!old || old.baseUrl === baseUrl || p.apiKey.trim(), '更换 API 地址必须重新填写新服务 Key，不会向新地址发送旧 Key')
    let encryptedKey = old?.encryptedKey
    if (p.apiKey.trim()) {
      const secure = storage()
      assert(secure?.isEncryptionAvailable(), '请在桌面程序中保存 Key，本机加密不可用')
      encryptedKey = secure.encryptString(p.apiKey.trim()).toString('base64')
    }
    const item = { id: old?.id ?? randomUUID(), name: p.name.trim(), baseUrl, model: p.model.trim(), format: p.format, encryptedKey }
    const next = [...profiles.filter(x => x.id !== item.id), item]
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(file + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 })
    renameSync(file + '.tmp', file)
    tickets.clear()
    return { profiles: list(), savedId: item.id }
  }
  function configuration(id) {
    const p = read().find(p => p.id === id)
    assert(p, '请选择已保存的文字 API 配置')
    let key = ''
    if (p.encryptedKey) {
      const secure = storage()
      assert(secure?.isEncryptionAvailable(), '无法解密文字 API Key，请在桌面程序中使用')
      key = secure.decryptString(Buffer.from(p.encryptedKey, 'base64'))
    }
    assert(key || ['localhost', '127.0.0.1', '[::1]'].includes(new URL(p.baseUrl).hostname), '该文字 API 未配置 Key')
    return { ...p, key }
  }
  function inputOf(raw) {
    exact(raw, ['profileId', 'workflowId', 'artifact', 'targetId', 'requirement', 'intake', 'context', 'references'])
    text(raw.requirement, 8000); text(raw.context || '无', 24000)
    assert(raw.intake && typeof raw.intake === 'object' && !Array.isArray(raw.intake), '接收信息格式无效')
    assert(Object.keys(raw.intake).length <= 40, '接收信息过多')
    Object.entries(raw.intake).forEach(([k, v]) => { text(k, 80); if (v !== '') text(v, 8000) })
    assert(Array.isArray(raw.references) && raw.references.length <= 30, '参考图分工数量无效')
    raw.references.forEach(r => { exact(r, ['number', 'note']); assert(Number.isInteger(r.number), '参考图编号无效'); if (r.note !== '') text(r.note, 2000) })
    assert(raw.references.every((r, i) => r.number === i + 1), '参考图编号必须与原始上传顺序一致')
    assert(targets(raw.workflowId, raw.artifact).some(t => t.id === raw.targetId), '优化目标无效')
    // 只复制文字产物，图片、文件路径和任意额外 artifact 字段都不进入上游请求。
    const artifact = { prompt: raw.artifact.prompt, channel: typeof raw.artifact.channel === 'string' ? raw.artifact.channel.slice(0, 500) : '' }
    if (Array.isArray(raw.artifact.params)) { assert(raw.artifact.params.length <= 20, '参数过多'); raw.artifact.params.forEach(p => text(p, 500)); artifact.params = raw.artifact.params }
    if (Array.isArray(raw.artifact.checklist)) { assert(raw.artifact.checklist.length <= 30, '检查项过多'); raw.artifact.checklist.forEach(p => text(p, 2000)); artifact.checklist = raw.artifact.checklist }
    return { ...raw, artifact }
  }
  async function invoke(profile, input, phase, schema, validate, extra, signal) {
    const system = modeRules(input) + (phase === 'analyze'
      ? '现在只分析并提供 3 个差异化修改方向，不输出修改后的提示词。id 按 1/2/3 排列。conflicts 只放阻止继续的冲突，若无则为空数组。'
      : '用户已经选定方向。严格只按该方向输出新版。parts 名称、数量与顺序必须与 expectedParts 完全一致，不返回整个分步流程。changes 说明实际修改，warnings 说明需要复核的事项；中文模式 params 必须为空数组。')
    const messages = [{ role: 'system', content: system + '\nJSON Schema:\n' + JSON.stringify(schema) }, { role: 'user', content: JSON.stringify({ ...input, profileId: undefined, expectedParts: expectedParts(input), ...extra }) }]
    return complete(profile, phase, schema, validate, messages, signal)
  }
  async function complete(profile, phase, schema, validate, messages, signal) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const body = { model: profile.model, messages, stream: false, ...officialRequestOptions(profile) }
      // 厂商专用参数仅发送到已核实的官方地址及模型，第三方兼容服务保持原样。
      if (profile.format === 'json_schema') body.response_format = { type: 'json_schema', json_schema: { name: 'prompt_iteration_' + phase, strict: true, schema } }
      if (profile.format === 'json_object') body.response_format = { type: 'json_object' }
      let response
      try {
        response = await fetchImpl(profile.baseUrl + '/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', ...(profile.key ? { authorization: 'Bearer ' + profile.key } : {}) }, body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]), redirect: 'error' })
      } catch {
        throw new Error(signal.aborted ? '请求已取消，原提示词未改动' : '文字 API 连接失败或超时，请检查地址和网络；原提示词未改动')
      }
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`文字 API 返回 HTTP ${response.status}；请检查 Key、模型权限及所选结构化输出方式（未自动重试计费请求）`)
      }
      const reader = response.body.getReader(); let size = 0; const chunks = []
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 512000) { await reader.cancel(); throw new Error('文字 API 响应超过大小限制') } chunks.push(Buffer.from(value)) }
      try {
        const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        const choice = envelope.choices?.[0]
        assert(choice?.finish_reason !== 'length', '输出被截断')
        assert(!choice?.message?.refusal, '模型拒绝本次请求')
        const value = JSON.parse(text(choice?.message?.content, 100000))
        return validate(value)
      } catch (e) {
        if (attempt) throw new Error('模型输出两次未通过格式或模式规则校验，原提示词未改动。请调整要求或切换模型。')
        messages.push({ role: 'user', content: '上次结果未通过本地校验：' + String(e.message).slice(0, 200) + '。请重新输出完整且严格符合上述 JSON Schema 和模式规则的对象，不要代码围栏或解释。' })
      }
    }
  }
  async function run(action, raw, signal = new AbortController().signal) {
    assert(!active, '另一个文字优化请求正在进行，请稍后再试')
    active = true
    try {
      for (const [id, t] of tickets) if (t.expires < now()) tickets.delete(id)
      if (action === 'analyze') {
        const input = inputOf(raw), profile = configuration(input.profileId)
        const analysis = await invoke(profile, input, 'analyze', ANALYSIS_SCHEMA, validateAnalysis, {}, signal)
        assert(!signal.aborted, '请求已取消')
        const ticket = randomUUID()
        if (tickets.size >= 50) tickets.delete(tickets.keys().next().value)
        tickets.set(ticket, { input, analysis, expires: now() + 30 * 60 * 1000 })
        return { ticket, ...analysis, model: profile.model }
      }
      assert(action === 'generate', '未知优化操作')
      exact(raw, ['ticket', 'directionId'])
      const session = tickets.get(raw.ticket)
      assert(session, '分析已过期或配置已修改，请重新分析')
      assert(session.analysis.conflicts.length === 0, '仍有约束冲突，请修改需求后重新分析')
      const direction = session.analysis.directions.find(d => d.id === raw.directionId)
      assert(direction, '请选择本轮分析给出的有效方向')
      const profile = configuration(session.input.profileId)
      const result = await invoke(profile, session.input, 'generate', REVISION_SCHEMA, v => ({ artifact: mergeRevision(session.input, v), changes: v.changes, warnings: v.warnings }), { selectedDirection: direction, analysis: session.analysis.analysis }, signal)
      assert(!signal.aborted, '请求已取消')
      tickets.delete(raw.ticket)
      return { ...result, model: profile.model }
    } finally { active = false }
  }
  async function pack(profileId, input, schema, validate, rules, signal = new AbortController().signal) {
    assert(!active, '另一个文字 API 请求正在进行，请稍后再试')
    active = true
    try {
      const profile = configuration(profileId)
      const messages = [{ role: 'system', content: rules + '\nJSON Schema:\n' + JSON.stringify(schema) }, { role: 'user', content: JSON.stringify(input) }]
      const result = await complete(profile, 'library', schema, validate, messages, signal)
      assert(!signal.aborted, '档案整理已取消')
      return { ...result, model: profile.model }
    } finally { active = false }
  }
  return { list, save, run, pack, isBusy: () => active }
}

export const iterationService = createIterationService()
const service = iterationService
export async function handleIteration(req, res, url) {
  const reply = (status, body) => { if (!res.destroyed) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) } }
  const controller = new AbortController()
  const close = () => { if (!res.writableEnded) controller.abort() }
  res.on('close', close)
  try {
    if (req.method === 'GET' && url.pathname === '/api/iteration/settings') return reply(200, { profiles: service.list() })
    assert((req.method === 'PUT' && url.pathname === '/api/iteration/settings') || (req.method === 'POST' && ['/api/iteration/analyze', '/api/iteration/generate'].includes(url.pathname)), '未知文字优化接口')
    const chunks = []; let size = 0
    for await (const chunk of req) { size += chunk.length; assert(size <= 180000, '文字优化请求超过大小限制'); chunks.push(chunk) }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const result = req.method === 'PUT' ? service.save(body) : await service.run(url.pathname.split('/').pop(), body, controller.signal)
    reply(200, result)
  } catch (error) { reply(400, { error: { message: error instanceof Error ? error.message : '文字优化失败' } }) }
  finally { res.removeListener('close', close) }
}
