/**
 * 验证 `npm run dev` 这一条命令能同时拉起代理与前端，且 Vite 的 /api 代理可用。
 * 结束后确认进程树被完整回收（Windows 上最容易出孤儿进程的地方）。
 */
import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'

/** 自动挑空闲端口，这样即使你本地已经开着 dev 服务也不会撞车。 */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

const apiPort = await freePort()
const webPort = await freePort()
const WEB = `http://127.0.0.1:${webPort}`
const API = `http://127.0.0.1:${apiPort}`
const results = []
let failures = 0

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  if (!ok) failures += 1
}

async function waitFor(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const value = await fn()
      if (value) return value
    } catch {
      // 继续等
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  return null
}

async function reachable(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
    return res.status
  } catch {
    return null
  }
}

const child = spawn(process.execPath, ['scripts/dev.mjs'], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    PW_API_PORT: String(apiPort),
    PW_WEB_PORT: String(webPort),
    // 自动化检查不应该弹出浏览器
    PW_NO_OPEN: '1',
  },
})

let log = ''
child.stdout.on('data', (d) => (log += d.toString()))
child.stderr.on('data', (d) => (log += d.toString()))

try {
  const proxyHealth = await waitFor(
    async () => {
      const res = await fetch(`${WEB}/api/health`, { signal: AbortSignal.timeout(2000) })
      return res.ok ? await res.json() : null
    },
    90_000,
    'vite 代理',
  )
  check('Vite 的 /api 代理转发到本地代理', proxyHealth?.ok === true, log.slice(-600))

  const direct = await reachable(`${API}/api/health`)
  check('本地代理直接可访问', direct === 200, String(direct))

  const page = await waitFor(
    async () => {
      const res = await fetch(WEB, { signal: AbortSignal.timeout(3000) })
      return res.ok ? await res.text() : null
    },
    30_000,
    'index.html',
  )
  check('前端页面返回 HTML', Boolean(page && page.includes('id="root"')), (page ?? '').slice(0, 120))
} catch (err) {
  check('dev 编排执行', false, err instanceof Error ? err.message : String(err))
} finally {
  if (child.pid !== undefined) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  }
  await new Promise((r) => setTimeout(r, 1500))
}

const webAfter = await reachable(WEB)
const apiAfter = await reachable(`${API}/api/health`)
check('前端端口已释放（无孤儿进程）', webAfter === null, String(webAfter))
check('代理端口已释放（无孤儿进程）', apiAfter === null, String(apiAfter))

console.log('\n===== dev 编排检查 =====')
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : `\n        ${r.detail}`}`)
}
console.log(`\n${results.length - failures}/${results.length} 通过`)
process.exit(failures === 0 ? 0 : 1)
