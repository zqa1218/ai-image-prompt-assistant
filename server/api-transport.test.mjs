import { it, expect } from 'vitest'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

it('真实本地 HTTP 路由：切换 API、透传规则和图片、不外传会话元数据、上游错误、切回网页', async () => {
  let received
  let upstreamError = false
  const upstream = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    received = { body: JSON.parse(Buffer.concat(chunks)), authorization: req.headers.authorization }
    res.writeHead(upstreamError ? 429 : 200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(upstreamError ? { error: { message: '测试限流' } } : { choices: [{ message: { content: '测试成功' } }], usage: { total_tokens: 12 } }))
  })
  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  const reserve = http.createServer().listen(0, '127.0.0.1')
  await once(reserve, 'listening')
  const port = reserve.address().port
  await new Promise((resolve) => reserve.close(resolve))
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pw-api-test-'))
  const child = spawn(process.execPath, ['server/index.mjs'], { stdio: 'ignore', env: { ...process.env,
    PW_API_PORT: String(port), PROMPT_WIZARD_DATA_DIR: dir, PROMPT_WIZARD_BRIDGE_DIR: dir,
    DEEPSEEK_API_KEY: 'test-key-not-real', DEEPSEEK_BASE_URL: `http://127.0.0.1:${upstream.address().port}`, DEEPSEEK_MODEL: 'deepseek-flash',
  } })
  const call = (endpoint, method = 'GET', body) => fetch(`http://127.0.0.1:${port}${endpoint}`, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  try {
    let ready = false
    for (let n = 0; n < 100; n++) {
      try { ready = (await call('/api/health')).ok } catch { /* 启动中 */ }
      if (ready) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    expect(ready).toBe(true)
    const settings = await (await call('/api/settings', 'PUT', { mode: 'api' })).json()
    expect(settings.mode).toBe('api')
    expect(settings.model).toBe('deepseek-flash')
    expect(JSON.stringify(settings)).not.toContain('test-key-not-real')
    const messages = [{ role: 'system', content: '真人 Cosplay 摄影后期 Skill / 置景合成 Skill' }, { role: 'user', content: [{ type: 'text', text: '保留人物' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] }]
    const response = await (await call('/api/chat', 'POST', { messages, conversationId: 'image-test', max_tokens: 100, response_format: { type: 'json_object' } })).json()
    expect(response.choices[0].message.content).toBe('测试成功')
    expect(received.body.messages).toEqual(messages)
    expect(received.body).not.toHaveProperty('conversationId')
    expect(received.body.model).toBe('deepseek-flash')
    expect(received.authorization).toBe('Bearer test-key-not-real')
    expect(received.body.response_format).toEqual({ type: 'json_object' })
    upstreamError = true
    const limited = await call('/api/chat', 'POST', { messages })
    expect(limited.status).toBe(429)
    expect((await limited.json()).error.message).toBe('测试限流')
    expect((await call('/api/settings', 'PUT', { baseUrl: 'https://different.example' })).status).toBe(400)
    await call('/api/settings', 'PUT', { mode: 'gemini-web' })
    expect((await call('/api/chat', 'POST', { messages })).status).toBe(503)
  } finally {
    const exited = once(child, 'exit')
    child.kill()
    await exited
    await new Promise((resolve) => upstream.close(resolve))
    await rm(dir, { recursive: true, force: true })
  }
}, 20000)
