import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

if (process.platform !== 'win32') throw new Error('候选桌面包冒烟测试目前只支持 Windows')

const root = path.resolve(import.meta.dirname, '..')
const executable = process.argv[2]
  ? path.resolve(root, process.argv[2])
  : path.join(root, 'release', 'candidate', 'win-unpacked', 'MJ Banana 创作工作台候选版.exe')
if (!fs.existsSync(executable)) throw new Error(`目录包不存在：${executable}`)

const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
const candidateDir = path.join(appData, 'MJStudioCandidate')
const descriptor = path.join(candidateDir, 'bridge.json')
const connector = path.join(candidateDir, 'connector.json')
const originalDescriptor = path.join(appData, 'PromptWizard', 'bridge.json')
const hash = file => fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null
const originalBefore = hash(originalDescriptor)
const sentinel = path.join(root, '.test-output', `candidate-smoke-${crypto.randomUUID()}.json`)

const child = spawn(executable, ['--enable-logging'], {
  cwd: path.dirname(executable),
  env: { ...process.env, PW_CANDIDATE_SMOKE: '1', PW_CANDIDATE_SMOKE_FILE: sentinel, ELECTRON_ENABLE_LOGGING: '1' },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
child.stdout.on('data', chunk => { output += chunk })
child.stderr.on('data', chunk => { output += chunk })

const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    child.kill()
    reject(new Error(`候选包 45 秒内没有正常退出\n${output}`))
  }, 45_000)
  child.once('error', error => { clearTimeout(timer); reject(error) })
  child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }) })
})

if (result.code !== 0) throw new Error(`候选包退出异常 code=${result.code} signal=${result.signal}\n${output}`)

for (let attempt = 0; attempt < 450 && !fs.existsSync(sentinel); attempt += 1) {
  await new Promise(resolve => setTimeout(resolve, 100))
}
if (!fs.existsSync(sentinel)) throw new Error(`候选包没有写入启动哨兵\n${output}`)
const evidence = JSON.parse(fs.readFileSync(sentinel, 'utf8'))
if (evidence.wizardUrl !== 'http://127.0.0.1:8791' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(evidence.workbenchUrl ?? '')) {
  throw new Error(`候选包启动证据无效：${JSON.stringify(evidence)}`)
}

for (let attempt = 0; attempt < 20 && (fs.existsSync(descriptor) || fs.existsSync(connector)); attempt += 1) {
  await new Promise(resolve => setTimeout(resolve, 100))
}
if (fs.existsSync(descriptor) || fs.existsSync(connector)) {
  throw new Error('候选包退出后没有清理桥或工作台连接文件')
}
if (hash(originalDescriptor) !== originalBefore) throw new Error('候选包修改了原 PromptWizard 桥文件')

console.log('[candidate-smoke] 打包态向导、工作台、双窗口和正常退出已通过')
console.log('[candidate-smoke] 候选桥与连接文件已清理，原 PromptWizard 桥未改变')
