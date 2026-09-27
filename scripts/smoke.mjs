/**
 * M0 冒烟测试：验证本地代理、设置读写、key 不回显、以及上游错误归一化。
 * 全程使用临时数据目录，不触碰项目里的真实 .env。
 *
 * 用法：node scripts/smoke.mjs [--upstream]
 *   --upstream  额外打一次真实上游（需要网络），用假 key 验证错误归一化
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const PORT = 8788
const BASE = `http://127.0.0.1:${PORT}`
const withUpstream = process.argv.includes('--upstream')
const FAKE_KEY = 'sk-test-not-a-real-key'

const results = []
let failures = 0

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  if (!ok) failures += 1
}

async function waitForHealth(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`)
      if (res.ok) return true
    } catch {
      // 还没起来
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

async function json(pathname, init) {
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: res.status, body }
}

const dataDir = await mkdtemp(path.join(tmpdir(), 'prompt-wizard-smoke-'))
const child = spawn(process.execPath, ['server/index.mjs'], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PROMPT_WIZARD_DATA_DIR: dataDir, PORT: String(PORT) },
})

let serverLog = ''
child.stdout.on('data', (d) => (serverLog += d.toString()))
child.stderr.on('data', (d) => (serverLog += d.toString()))

try {
  const up = await waitForHealth()
  check('服务启动 /api/health', up, up ? '' : serverLog.trim())
  if (!up) throw new Error('服务未启动')

  const settings1 = await json('/api/settings')
  check(
    '未配置 key 时 hasKey=false',
    settings1.status === 200 && settings1.body?.hasKey === false,
    JSON.stringify(settings1.body),
  )
  check(
    '设置响应不含 key 明文',
    !JSON.stringify(settings1.body).includes('sk-'),
    JSON.stringify(settings1.body),
  )

  const modelsNoKey = await json('/api/models')
  check(
    '无 key 调 /api/models 返回 401 且有可读提示',
    modelsNoKey.status === 401 && typeof modelsNoKey.body?.error?.message === 'string',
    JSON.stringify(modelsNoKey.body),
  )

  const saved = await json('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-flash',
      apiKey: FAKE_KEY,
    }),
  })
  check(
    '保存设置后 hasKey=true',
    saved.status === 200 && saved.body?.hasKey === true,
    JSON.stringify(saved.body),
  )
  check(
    '保存响应仍不含 key 明文',
    !JSON.stringify(saved.body).includes(FAKE_KEY),
    JSON.stringify(saved.body),
  )

  const envText = await readFile(path.join(dataDir, '.env'), 'utf8').catch(() => '')
  check('key 落盘到 .env', envText.includes(`DEEPSEEK_API_KEY=${FAKE_KEY}`), envText.trim())

  const cfgText = await readFile(path.join(dataDir, '.prompt-wizard.json'), 'utf8').catch(() => '')
  check(
    '配置落盘到 .prompt-wizard.json',
    cfgText.includes('"model": "deepseek-flash"'),
    cfgText.trim(),
  )

  const chatNoKeyBody = await json('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  })
  check(
    '/api/chat 可用（假 key 会拿到上游错误而非崩溃）',
    chatNoKeyBody.status >= 400 &&
      typeof chatNoKeyBody.body?.error?.message === 'string',
    `${chatNoKeyBody.status} ${JSON.stringify(chatNoKeyBody.body).slice(0, 200)}`,
  )

  if (withUpstream) {
    const models = await json('/api/models')
    check(
      '假 key 打真实上游时错误被归一化',
      models.status >= 400 &&
        models.status < 600 &&
        typeof models.body?.error?.message === 'string' &&
        !JSON.stringify(models.body).includes(FAKE_KEY),
      `${models.status} ${JSON.stringify(models.body).slice(0, 300)}`,
    )
    console.log(`\n[upstream] /api/models -> ${models.status} ${JSON.stringify(models.body)}`)
  } else {
    console.log('\n[提示] 加 --upstream 可额外打一次真实上游验证错误归一化')
  }
} catch (err) {
  check('冒烟测试执行', false, err instanceof Error ? err.message : String(err))
} finally {
  child.kill()
  await rm(dataDir, { recursive: true, force: true }).catch(() => {})
}

console.log('\n===== M0 冒烟结果 =====')
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : `\n        ${r.detail}`}`)
}
console.log(`\n${results.length - failures}/${results.length} 通过`)
process.exit(failures === 0 ? 0 : 1)
