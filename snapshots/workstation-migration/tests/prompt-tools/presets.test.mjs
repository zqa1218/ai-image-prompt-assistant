import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MODEL_PRESETS, presetForm, officialRequestOptions } from '../../shared/model-presets.mjs'
import { createIterationService } from '../../server/iteration-server.mjs'

test('四个官方预设，无密钥，格式适配准确，每次返回独立表单', () => {
  assert.equal(MODEL_PRESETS.length, 4)
  for (const p of MODEL_PRESETS) {
    const form = presetForm(p.id); assert.equal(form.id, ''); assert.equal(form.apiKey, '')
    assert.equal(form.format, p.id.startsWith('deepseek') ? 'json_object' : 'prompt')
    form.apiKey = 'not-shared'; assert.equal(presetForm(p.id).apiKey, '')
  }
  assert.throws(() => presetForm('unknown'))
})
test('官方参数适配：DeepSeek Flash 非思考、Pro 低思考、MiniMax 分离思考但不禁用', () => {
  assert.deepEqual(officialRequestOptions(presetForm('deepseek-flash')), { thinking: { type: 'disabled' }, max_tokens: 8192 })
  assert.equal(officialRequestOptions(presetForm('deepseek-pro')).reasoning_effort, 'low')
  for (const id of ['minimax-cn', 'minimax-global']) {
    const options = officialRequestOptions(presetForm(id))
    assert.equal(options.reasoning_split, true); assert.equal(options.thinking, undefined)
    assert.equal(options.reasoning_effort, 'low'); assert.equal(options.max_completion_tokens, 16384)
  }
})
test('不向自定义服务、相似域名或其它模型发送厂商专用参数', () => {
  const p = presetForm('deepseek-flash')
  for (const baseUrl of ['https://api.deepseek.com.evil.test', 'http://api.deepseek.com', 'https://proxy.test/v1', 'https://api.deepseek.com:8443', 'https://api.deepseek.com/other']) assert.deepEqual(officialRequestOptions({ ...p, baseUrl }), {})
  assert.deepEqual(officialRequestOptions({ ...p, model: 'custom-model' }), {})
})
test('保存预设不调用上游；实际请求只携带对应模型参数和格式，Key 不回显', async () => {
  for (const p of MODEL_PRESETS) {
    const requests = []
    const service = createIterationService({ dataDir: mkdtempSync(path.join(os.tmpdir(), 'pw-preset-')), storage: () => ({ isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString() }), fetchImpl: async (url, opts) => { requests.push({ url, body: JSON.parse(opts.body) }); return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}', reasoning_content: 'ignored' } }] })) } })
    const saved = service.save({ ...presetForm(p.id), apiKey: 'fake-test-key' })
    assert.equal(requests.length, 0); assert.ok(!JSON.stringify(saved).includes('fake-test-key'))
    await service.pack(saved.savedId, { task: 'test' }, { type: 'object' }, v => v, 'Only JSON')
    const body = requests[0].body
    assert.equal(body.model, p.model); assert.equal(requests[0].url, p.baseUrl + '/chat/completions')
    assert.equal(body.response_format?.type, p.format === 'prompt' ? undefined : 'json_object')
    for (const [k, v] of Object.entries(officialRequestOptions(p))) assert.deepEqual(body[k], v)
  }
})
