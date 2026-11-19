import { spawn, spawnSync } from 'node:child_process'

const isWindows = process.platform === 'win32'
const children = []
let shuttingDown = false

/** Vite 就绪后自动打开浏览器；PW_NO_OPEN=1 可关闭（自动化测试会用到）。 */
function openBrowser(url) {
  if (process.env.PW_NO_OPEN === '1') return
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
  try {
    spawn(command, args, { stdio: 'ignore', detached: true }).unref()
    console.log(`[dev] 已在浏览器打开 ${url}`)
  } catch {
    console.log(`[dev] 自动打开浏览器失败，请手动访问 ${url}`)
  }
}

function run(name, command, options = {}) {
  const child = spawn(command, {
    stdio: options.onOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: true,
    cwd: process.cwd(),
  })
  if (options.onOutput) {
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk)
      options.onOutput(chunk.toString())
    })
    child.stderr.on('data', (chunk) => process.stderr.write(chunk))
  }
  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    console.error(`[dev] ${name} 已退出（code=${code} signal=${signal}），正在停止其余进程`)
    shutdown(code ?? 1)
  })
  children.push({ name, child })
}

function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const { child } of children) {
    if (child.exitCode === null && !child.killed) {
      killTree(child)
    }
  }
  setTimeout(() => process.exit(code), 300)
}

/**
 * Windows 上子进程是用 shell 启动的，child.kill() 只会杀掉 cmd.exe，
 * 真正跑着的 node / vite 会变成孤儿进程，所以用 taskkill 杀整棵树。
 */
function killTree(child) {
  if (!isWindows) {
    child.kill('SIGTERM')
    return
  }
  if (child.pid === undefined) {
    child.kill()
    return
  }
  spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

run('server', 'node server/index.mjs')

let browserOpened = false
run('web', 'npx vite', {
  onOutput(text) {
    if (browserOpened) return
    const match = /https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/.exec(text)
    if (!match) return
    browserOpened = true
    openBrowser(`http://127.0.0.1:${match[1]}`)
  },
})
