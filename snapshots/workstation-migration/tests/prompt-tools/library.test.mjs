import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sourceOf, libraryParts, validateLibrary, LIBRARY_RULES, PRESERVE_ZH, PRESERVE_EN } from '../../shared/library-core.mjs'
import { createLibraryService } from '../../server/library-server.mjs'
import { createIterationService } from '../../server/iteration-server.mjs'

const steps = '【第1步·背景与景别陈设】\n红衣女孩坐在石阶上，重建石阶和庭院。\n\n【第2步·身体互动特效】\n在手边加入蓝色电弧，服饰不变。\n\n【第3步·氛围层】\n加入薄雾，保留前两步。'
const source = (mode = 'refine') => sourceOf({ workflowId: mode, artifact: { prompt: mode === 'refine-steps' ? steps : '红衣女孩微笑，加入石阶庭院与薄雾。', channel: 'test', dataUrl: 'data:image/not-allowed' } })
const result = s => ({ name: '石阶薄雾', summary: '保留场景中的石阶与薄雾效果。', parts: libraryParts(s).map(p => ({ key: p.key, body: s.workflowId === 'recompose' ? 'stone courtyard, subtle mist --ar 3:4 --no blur' : '加入石阶与薄雾，适配当前底图已有姿势和接触点。' })), warnings: ['复用前确认原有接触点适合场景。'] })
function fixture({ fail = false } = {}) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'pw-library-unit-')), calls = []
  const api = { list: () => [{ id: 'model-one' }], isBusy: () => false, pack: async (profile, input, schema, validate, rules) => {
    calls.push({ profile, input, schema, rules })
    if (fail) throw Error('模拟网络失败')
    return { ...validate({ name: '石阶薄雾', summary: '环境与氛围模板。', parts: input.expectedParts.map(p => ({ key: p.key, body: input.workflowId === 'recompose' ? 'stone courtyard, subtle mist' : '加入石阶与薄雾。' })), warnings: [] }), model: 'fake-model' }
  } }
  const library = createLibraryService({ dataDir, api, schedule: false })
  return { library, dataDir, api, calls }
}

test('档案分组 1/1/3，人物保留句与步骤衔接由程序固定补齐', () => {
  for (const mode of ['refine', 'recompose', 'refine-steps']) {
    const s = source(mode), value = validateLibrary(s, result(s))
    assert.equal(value.parts.length, mode === 'refine-steps' ? 3 : 1)
    for (const p of value.parts) assert.ok(p.body.includes(mode === 'recompose' ? PRESERVE_EN : PRESERVE_ZH))
    if (mode === 'refine-steps') { assert.ok(value.parts[1].body.startsWith('使用第1步输出图')); assert.ok(value.parts[2].body.startsWith('使用第2步输出图')) }
    assert.ok(value.warnings.some(w => w.includes('尚未人工复核')))
  }
})
test('拦截错误段数、错序、多段、旧引用、图像参数、路径和语言', () => {
  const s = source('refine-steps'), v = result(s)
  assert.throws(() => validateLibrary(s, { ...v, parts: v.parts.slice(0, 1) }))
  assert.throws(() => validateLibrary(s, { ...v, parts: [...v.parts].reverse() }))
  for (const body of ['参考图1的背景', 'REFERENCE_2 的场景', '访问 https://example.test/a.jpg', '加载 C:\\pics\\a.png', '第一段\n第二段', '【正面提示词】夜景', 'night scene', '使用 --cref old']) {
    const single = source(); assert.throws(() => validateLibrary(single, { ...result(single), parts: [{ key: '完整提示词', body }] }), body)
  }
})
test('只保留白名单文字，档案名约束、图片与路径 traversal 均受校验', () => {
  assert.equal(source().artifact.dataUrl, undefined)
  assert.throws(() => sourceOf({ workflowId: 'refine', artifact: { prompt: 'data:image/png;base64,AAA' } }))
  const s = source(); assert.throws(() => validateLibrary(s, { ...result(s), name: 'x' }))
  const { library } = fixture(); assert.throws(() => library.detail('../settings'))
  assert.match(LIBRARY_RULES, /删除具体人物/); assert.match(LIBRARY_RULES, /不虚构附件/)
})
test('默认只本地入库不收费，去重，重启持久化，分步整份入库', async () => {
  const f = fixture(), s = source('refine-steps')
  const first = f.library.ingest(s), duplicate = f.library.ingest(s)
  assert.equal(first.id, duplicate.id); assert.equal(duplicate.duplicate, true)
  await f.library.pump(); assert.equal(f.calls.length, 0)
  assert.equal(f.library.list().entries.length, 1)
  const reopened = createLibraryService({ dataDir: f.dataDir, api: f.api, schedule: false })
  assert.equal(reopened.detail(first.id).source.artifact.prompt, steps)
})
test('手动整理绑定模型，完整三步一个档案，原文不覆盖，重复整理不计费', async () => {
  const f = fixture(), s = source('refine-steps'), { id } = f.library.ingest(s)
  f.library.enqueue(id, 'model-one'); await f.library.pump()
  const record = f.library.detail(id)
  assert.equal(record.status, 'ready'); assert.equal(record.result.parts.length, 3)
  assert.equal(record.source.artifact.prompt, steps)
  assert.equal(f.calls[0].profile, 'model-one'); assert.ok(!JSON.stringify(f.calls).includes('data:image'))
  assert.throws(() => f.library.enqueue(id, 'model-one'), /已整理/)
  assert.equal(f.calls.length, 1)
})
test('开启自动仅处理新档案，关闭取消尚未开始的自动任务，手动任务不丢失', async () => {
  const f = fixture(), old = f.library.ingest(source())
  f.library.saveSettings({ autoProcess: true, profileId: 'model-one' })
  assert.equal(f.library.detail(old.id).status, 'pending')
  const second = f.library.ingest(source('refine-steps'))
  assert.equal(second.status, 'queued')
  f.library.enqueue(old.id, 'model-one')
  f.library.saveSettings({ autoProcess: false, profileId: 'model-one' })
  assert.equal(f.library.detail(second.id).status, 'pending')
  assert.equal(f.library.detail(old.id).status, 'queued')
  await f.library.pump(); assert.equal(f.calls.length, 1)
})
test('自动整理失败保留原文且不循环计费；人工重试可重新排队', async () => {
  const f = fixture({ fail: true }), { id } = f.library.ingest(source())
  f.library.enqueue(id, 'model-one'); await f.library.pump(); await f.library.pump()
  assert.equal(f.library.detail(id).status, 'error'); assert.equal(f.calls.length, 1)
  assert.equal(f.library.detail(id).source.artifact.prompt, source().artifact.prompt)
  f.library.enqueue(id, 'model-one'); await f.library.pump(); assert.equal(f.calls.length, 2)
})
test('整理队列让出文字 API，回收站可恢复且不会隐式再计费', async () => {
  const f = fixture(), { id } = f.library.ingest(source())
  f.library.enqueue(id, 'model-one'); f.api.isBusy = () => true
  await f.library.pump(); assert.equal(f.calls.length, 0)
  f.library.update(id, { trashed: true }); assert.equal(f.library.detail(id).status, 'pending')
  f.library.update(id, { trashed: false }); assert.equal(f.library.list().entries[0].trashed, false)
  assert.equal(f.library.ingest(source()).duplicate, true)
})
test('程序重启时中断任务标错不自动重复计费，损坏档案留在磁盘', async () => {
  const f = fixture(), { id } = f.library.ingest(source()), file = path.join(f.dataDir, 'prompt-library', id + '.json')
  const record = JSON.parse(readFileSync(file)); record.status = 'processing'; writeFileSync(file, JSON.stringify(record))
  const reopened = createLibraryService({ dataDir: f.dataDir, api: f.api, schedule: false })
  assert.equal(reopened.detail(id).status, 'error'); await reopened.pump(); assert.equal(f.calls.length, 0)
  writeFileSync(file, 'broken json')
  assert.equal(reopened.list().damagedCount, 1); assert.equal(readFileSync(file, 'utf8'), 'broken json')
  assert.throws(() => reopened.ingest(source()))
})
test('真实共用 API 调用层执行档案 schema 校验及一次纠错', async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'pw-library-wire-')), calls = []
  const s = source()
  const api = createIterationService({ dataDir, fetchImpl: async (url, opts) => {
    calls.push(JSON.parse(opts.body))
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(calls.length === 1 ? { wrong: true } : result(s)) } }] }))
  } })
  const { savedId } = api.save({ id: '', name: '本机', model: 'chosen', baseUrl: 'http://127.0.0.1:10001', format: 'json_schema', apiKey: '' })
  const library = createLibraryService({ dataDir, api, schedule: false }), { id } = library.ingest(s)
  library.enqueue(id, savedId); await library.pump()
  assert.equal(library.detail(id).status, 'ready'); assert.equal(calls.length, 2)
  assert.equal(calls[0].response_format.json_schema.name, 'prompt_iteration_library')
  assert.equal(calls[0].model, 'chosen'); assert.match(calls[0].messages[0].content, /人物/)
})
