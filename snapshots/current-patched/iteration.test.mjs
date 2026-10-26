import test from 'node:test'
import strict from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { targets, stepRanges, mergeRevision, validateAnalysis, expectedParts, modeRules } from './iteration-core.mjs'
import { createIterationService } from './work/server/iteration-server.mjs'

const steps = '【第1步·背景与景别陈设】\n使用原始底图，保持人物不变，重建石阶。\n\n【第2步·身体互动特效】\n本步不使用参考图。用第1步输出图，只加蓝色电弧。\n\n【第3步·氛围层】\n用第2步输出图，保持人物与环境不变，添加薄雾。'
const base = (workflowId = 'refine-steps', targetId = '1') => ({ profileId: '', workflowId, targetId, requirement: '降低强度', artifact: { prompt: workflowId === 'refine-steps' ? steps : '保留人物，背景改为暖灰色。', channel: 'Gemini' }, intake: {}, context: '原分析', references: [] })
const analysis = () => ({ analysis: '将仅调整用户要求的范围。', conflicts: [], directions: ['1', '2', '3'].map(id => ({ id, title: '方向' + id, changes: '降低强度' + id, expected: '更自然', risk: '可能减弱效果' })), recommendedId: '1' })
function revision(input, body = '使用原始底图，保留人物身份与动作，降低石阶亮度。') { return { parts: expectedParts(input).map(p => ({ key: p.key, body })), params: [], changes: ['降低亮度'], warnings: [] } }
function fixture(outputs = []) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'pw-iteration-test-'))
  const requests = [], queue = [...outputs]
  const storage = () => ({ isEncryptionAvailable: () => true, encryptString: s => Buffer.from('fixture:' + s), decryptString: b => b.toString().slice(8) })
  let time = Date.now()
  const service = createIterationService({ dataDir, storage, now: () => time, fetchImpl: async (url, opts) => { requests.push({ url, ...opts, body: JSON.parse(opts.body) }); const out = queue.shift(); if (out instanceof Response) return out; return new Response(JSON.stringify({ choices: [{ message: { content: typeof out === 'string' ? out : JSON.stringify(out) }, finish_reason: 'stop' }] })) } })
  const saved = service.save({ id: '', name: '测试模型', baseUrl: 'https://example.test/v1', model: 'fake-model', format: 'json_object', apiKey: 'fake-key' })
  return { service, id: saved.savedId, requests, dataDir, advance: () => { time += 31 * 60 * 1000 } }
}

test('三条线入口数量为 1 / 1 / 3', () => {
  strict.equal(targets('refine', base('refine').artifact).length, 1)
  const mj = { prompt: '【正面提示词】\nportrait, soft light\n\n【负面提示词】\nblur, artifacts' }
  strict.equal(targets('recompose', mj).length, 1)
  strict.equal(targets('refine-steps', base().artifact).length, 3)
})
test('分步修改逐字保留未选中的两步、保留标题与换行', () => {
  for (const id of ['1', '2', '3']) {
    const input = base('refine-steps', id), body = id === '2' ? '本步不使用参考图。用第1步输出图，保留人物，降低蓝色电弧强度。' : '保持人物与前一步内容不变，只降低本步强度。'
    const result = mergeRevision(input, revision(input, body))
    const before = stepRanges(steps), after = stepRanges(result.prompt)
    before.forEach((r, i) => { if (String(i + 1) !== id) strict.equal(steps.slice(r.start, r.end), result.prompt.slice(after[i].start, after[i].end)) })
    strict.equal(result.channel, input.artifact.channel)
  }
})
test('拦截跨步骤标题、错误编号、参考图越界、额外字段', () => {
  const a = base(), b = base('refine-steps', '2')
  strict.throws(() => mergeRevision(a, revision(a, '【第2步·身体互动特效】\n篡改第二步')))
  strict.throws(() => mergeRevision(a, revision(a, '参考图1中的石头')))
  strict.throws(() => mergeRevision(b, revision(b, '本步使用 REFERENCE_1，只借用它的形状。')))
  strict.throws(() => mergeRevision(b, revision(b, '本步使用 REFERENCE_0，只借用它的形状。')))
  strict.throws(() => mergeRevision(a, { ...revision(a), extra: 'no' }))
  strict.throws(() => targets('refine-steps', { prompt: '非分步提示词' }))
})
test('MJ 正负面与参数合并同步，不能把参数塞进正文', () => {
  const input = base('recompose', 'all')
  input.artifact.prompt = '【完整一行（可直接粘贴）】\nold\n\n【正面提示词】\nportrait, soft light\n\n【负面提示词】\nblur, noise\n\n【参数】\n--ar 3:4'
  const v = { parts: [{ key: '正面提示词', body: 'portrait, warm light' }, { key: '负面提示词', body: 'blur, artifacts' }], params: ['--ar 3:4'], changes: ['暖光'], warnings: [] }
  const result = mergeRevision(input, v)
  strict.ok(result.prompt.includes('portrait, warm light --ar 3:4 --no blur, artifacts'))
  strict.deepEqual(result.params, ['--ar 3:4'])
  strict.throws(() => mergeRevision(input, { ...v, parts: [{ key: '正面提示词', body: 'portrait --ar 1:1' }, v.parts[1]] }))
  strict.throws(() => mergeRevision(input, { ...v, params: ['--ar 3:4 --no text'] }))
})
test('精修置景合成禁引用；参考图参与模式允许引用', () => {
  const input = base('refine', 'all'); input.intake.taskType = '置入物体'
  strict.throws(() => mergeRevision(input, revision(input, '借用 REFERENCE_1 的石块，保留人物。')))
  input.intake.referencePolicy = '参考图参与'
  input.references = [{ number: 1, note: '石块材质' }]
  strict.ok(mergeRevision(input, revision(input, '借用 REFERENCE_1 的石块，保留人物。')))
  strict.throws(() => mergeRevision(input, revision(input, '借用 REFERENCE_2 的石块，保留人物。')))
})
test('分析必须为 3 个方向，编号唯一且推荐有效', () => {
  strict.ok(validateAnalysis(analysis()))
  strict.throws(() => validateAnalysis({ ...analysis(), directions: [] }))
  strict.throws(() => validateAnalysis({ ...analysis(), recommendedId: '9' }))
  strict.throws(() => validateAnalysis({ ...analysis(), directions: analysis().directions.map(d => ({ ...d, changes: '相同改动' })) }))
})
test('两阶段 API 使用所选模型，仅文字；生成需要服务端有效 ticket 与选项', async () => {
  const input = base(), f = fixture([analysis(), revision(input)])
  input.profileId = f.id; input.artifact.dataUrl = 'data:image/SHOULD_NOT_SEND'
  const a = await f.service.run('analyze', input)
  strict.equal(f.requests.length, 1)
  strict.equal(f.requests[0].body.model, 'fake-model')
  strict.equal(f.requests[0].body.thinking, undefined)
  strict.equal(f.requests[0].body.response_format.type, 'json_object')
  strict.ok(!JSON.stringify(f.requests[0].body).includes('data:image'))
  await strict.rejects(f.service.run('generate', { ticket: a.ticket, directionId: '9' }))
  strict.equal(f.requests.length, 1)
  const result = await f.service.run('generate', { ticket: a.ticket, directionId: '1' })
  strict.ok(result.artifact.prompt.includes('降低石阶亮度'))
  await strict.rejects(f.service.run('generate', { ticket: a.ticket, directionId: '1' }))
})
test('冲突、过期、保存配置使旧建议失效，不发起生成', async () => {
  const f = fixture([{ ...analysis(), conflicts: ['要求跨步修改背景'] }, analysis(), analysis()]), input = { ...base(), profileId: f.id }
  let a = await f.service.run('analyze', input)
  await strict.rejects(f.service.run('generate', { ticket: a.ticket, directionId: '1' }), /冲突/)
  a = await f.service.run('analyze', input); f.advance()
  await strict.rejects(f.service.run('generate', { ticket: a.ticket, directionId: '1' }), /过期/)
  a = await f.service.run('analyze', input)
  f.service.save({ id: f.id, name: '新模型', baseUrl: 'https://example.test/v1', model: 'new-model', format: 'prompt', apiKey: '' })
  await strict.rejects(f.service.run('generate', { ticket: a.ticket, directionId: '1' }), /过期/)
  strict.equal(f.requests.length, 3)
})
test('不合格返回只纠正一次，不回退到原始文本', async () => {
  const f = fixture(['```json\n{}\n```', 'not JSON']), input = { ...base(), profileId: f.id }
  await strict.rejects(f.service.run('analyze', input), /两次/)
  strict.equal(f.requests.length, 2)
  strict.equal(input.artifact.prompt, steps)
})
test('HTTP 错误不自动重试，不向界面泄露上游正文', async () => {
  const f = fixture([new Response('secret upstream data', { status: 401 })])
  await strict.rejects(f.service.run('analyze', { ...base(), profileId: f.id }), /HTTP 401/)
  strict.equal(f.requests.length, 1)
})
test('Key 不返回给前端，换地址禁止复用旧 Key；生产加密不可用拒绝保存', () => {
  const f = fixture()
  strict.equal(f.service.list()[0].apiKey, undefined)
  strict.equal(f.service.list()[0].encryptedKey, undefined)
  strict.equal(f.service.list()[0].hasKey, true)
  const p = { id: f.id, name: 'test', baseUrl: 'https://other.test/v1', model: 'test', format: 'json_object', apiKey: '' }
  strict.throws(() => f.service.save(p), /重新填写/)
  strict.throws(() => f.service.save({ ...p, baseUrl: 'http://example.test' }), /HTTPS/)
  const unavailable = createIterationService({ dataDir: mkdtempSync(path.join(os.tmpdir(), 'pw-no-crypto-')), storage: () => undefined })
  strict.throws(() => unavailable.save({ ...p, id: '', apiKey: 'fake' }), /加密/)
})
test('所有模式预设文字处理边界与模式规则', () => {
  for (const mode of ['refine', 'recompose', 'refine-steps']) strict.match(modeRules(base(mode)), /不提供图片/)
  strict.match(modeRules(base('refine-steps')), /其它步骤只读/)
})

test('三种结构化策略均使用所选配置，不擅自降级接口参数', async () => {
  for (const format of ['json_schema', 'json_object', 'prompt']) {
    const f = fixture([analysis()])
    f.service.save({ id: f.id, name: '模式测试', baseUrl: 'https://example.test/v1', model: 'chosen-model', format, apiKey: '' })
    await f.service.run('analyze', { ...base(), profileId: f.id })
    strict.equal(f.requests[0].body.model, 'chosen-model')
    strict.equal(f.requests[0].body.response_format?.type, format === 'prompt' ? undefined : format)
    if (format === 'json_schema') strict.equal(f.requests[0].body.response_format.json_schema.strict, true)
    strict.equal(f.requests[0].redirect, 'error')
  }
})

test('并发请求与配置变更被阻止；取消后迟到的回复不能产生有效分析', async () => {
  let resolveReply
  const service = createIterationService({
    dataDir: mkdtempSync(path.join(os.tmpdir(), 'pw-iteration-cancel-')),
    fetchImpl: () => new Promise(resolve => { resolveReply = resolve }),
  })
  const p = { id: '', name: '本地测试', baseUrl: 'http://127.0.0.1:12345', model: 'fake', format: 'prompt', apiKey: '' }
  const { savedId } = service.save(p)
  const controller = new AbortController(), input = { ...base(), profileId: savedId }
  const pending = service.run('analyze', input, controller.signal)
  await strict.rejects(service.run('analyze', input), /正在进行/)
  strict.throws(() => service.save({ ...p, id: savedId }), /正在回复/)
  controller.abort()
  resolveReply(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(analysis()) } }] })))
  await strict.rejects(pending, /取消/)
  strict.doesNotThrow(() => service.save({ ...p, id: savedId }))
})
