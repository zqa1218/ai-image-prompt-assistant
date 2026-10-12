/**
 * 用真实 Chrome / Edge 承载 Gemini 网页会话，通过 CDP 复用原有自动化。
 *
 * 为什么不用 Electron 内嵌窗口：Google 登录页会直接拒绝内嵌浏览器
 * （跳到 accounts.google.com/v3/signin/rejected →「此浏览器或应用可能不安全」），
 * 伪造 UA 与 Client Hints 也无效；真实浏览器可以正常登录并长期保持会话。
 *
 * 对外暴露的接口故意做成和 BrowserWindow 一样，
 * 这样 GeminiWebController 里的自动化代码（evaluate / 输入 / 上传）不用改写。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const PORT_FILE = 'promptwizard-cdp.json'
const PROGRAM_FILES = process.env.ProgramFiles || 'C:\\Program Files'
const PROGRAM_FILES_X86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
const LOCAL_APP_DATA = process.env.LOCALAPPDATA || ''

const BROWSER_CANDIDATES = [
  path.join(PROGRAM_FILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(PROGRAM_FILES_X86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(LOCAL_APP_DATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(PROGRAM_FILES_X86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  path.join(PROGRAM_FILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
]

/** 找不到真实浏览器时返回空串，调用方回退到内嵌窗口。 */
export function findBrowserExecutable(explicit) {
  const candidates = [explicit, process.env.PW_BROWSER_PATH, ...BROWSER_CANDIDATES]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue
    try { if (existsSync(candidate)) return candidate } catch { /* 忽略不可读路径 */ }
  }
  return ''
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

async function readVersion(port, timeout = 2000) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(timeout) })
    return response.ok ? await response.json() : null
  } catch { return null }
}

async function readTargets(port, timeout = 3000) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(timeout) })
    return response.ok ? await response.json() : []
  } catch { return [] }
}

function isPageTarget(target) {
  return target?.type === 'page' && typeof target.url === 'string'
    && !target.url.startsWith('chrome-extension://') && !target.url.startsWith('devtools://')
    && !target.url.startsWith('chrome://')
}

class CdpConnection {
  constructor(socket) {
    this.socket = socket
    this.sequence = 0
    this.pending = new Map()
    this.listeners = new Set()
    this.closed = false
    socket.addEventListener('message', (event) => this.#dispatch(event.data))
    socket.addEventListener('close', () => this.#fail(new Error('浏览器调试连接已断开')))
    socket.addEventListener('error', () => this.#fail(new Error('浏览器调试连接出错')))
  }

  static async connect(url, timeout = 15000) {
    if (typeof WebSocket !== 'function') throw new Error('当前运行时缺少 WebSocket，无法连接浏览器')
    const socket = new WebSocket(url)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('连接浏览器调试端口超时')), timeout)
      socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('浏览器调试端口连接失败')) }, { once: true })
    })
    return new CdpConnection(socket)
  }

  onEvent(callback) {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  send(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new Error('浏览器调试连接已断开'))
    const id = (this.sequence += 1)
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }

  close() {
    try { this.socket.close() } catch { /* 已经断开 */ }
    this.#fail(new Error('浏览器会话已关闭'))
  }

  #dispatch(raw) {
    let message
    try { message = JSON.parse(typeof raw === 'string' ? raw : String(raw)) } catch { return }
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id)
      this.pending.delete(message.id)
      if (message.error) reject(new Error(message.error.message || '浏览器调试命令失败'))
      else resolve(message.result)
      return
    }
    if (!message.method) return
    for (const listener of [...this.listeners]) {
      try { listener(message.method, message.params || {}, message.sessionId) } catch { /* 监听器异常不影响主流程 */ }
    }
  }

  #fail(error) {
    if (this.closed) return
    this.closed = true
    for (const { reject } of this.pending.values()) reject(error)
    this.pending.clear()
    for (const listener of [...this.listeners]) {
      try { listener('__closed__', {}, undefined) } catch { /* 忽略 */ }
    }
  }
}

/** Ctrl/Cmd 之外只用到回车，够 Gemini 发送用了。 */
function keyEventParams(event) {
  const name = String(event.keyCode || event.key || '')
  const params = { type: event.type === 'keyUp' ? 'keyUp' : 'keyDown', key: name, windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, code: 'Enter' }
  if (event.type !== 'keyUp') params.text = '\r'
  return params
}

class CdpWebContents {
  constructor(session) {
    this.session = session
    this.debugger = {
      isAttached: () => true,
      attach: () => {},
      sendCommand: (method, params) => session.send(method, params),
      on: (_event, callback) => { session.messageListeners.add(callback) },
      removeListener: (_event, callback) => { session.messageListeners.delete(callback) },
    }
  }

  getURL() { return this.session.url }

  setUserAgent() { /* 真实浏览器自带 UA，不需要伪造 */ }

  setWindowOpenHandler(handler) { this.session.windowOpenHandler = handler }

  executeJavaScript(script) { return this.session.evaluate(script) }

  async insertText(text) { await this.session.send('Input.insertText', { text }) }

  async sendInputEvent(event) {
    if (event.type === 'mouseMove') return this.session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: event.x, y: event.y })
    if (event.type === 'mouseDown') return this.session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: event.x, y: event.y, button: 'left', clickCount: event.clickCount || 1, buttons: 1 })
    if (event.type === 'mouseUp') return this.session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: event.x, y: event.y, button: 'left', clickCount: event.clickCount || 1, buttons: 0 })
    if (event.type === 'keyDown' || event.type === 'keyUp') return this.session.send('Input.dispatchKeyEvent', keyEventParams(event))
    return undefined
  }
}

export class CdpBrowserSession {
  constructor({ connection, targetId, sessionId, port, child, profileDir, url }) {
    this.connection = connection
    this.targetId = targetId
    this.sessionId = sessionId
    this.port = port
    this.child = child
    this.profileDir = profileDir
    this.url = url || ''
    this.closed = false
    this.closeCallbacks = new Set()
    this.messageListeners = new Set()
    this.windowOpenHandler = null
    this.webContents = new CdpWebContents(this)
    this.connection.onEvent((method, params, sessionId) => this.#onEvent(method, params, sessionId))
    if (child) child.on('exit', () => this.#onClosed())
  }

  static async launch({ profileDir, executable, startUrl, extraArgs = [] }) {
    const browser = findBrowserExecutable(executable)
    if (!browser) throw new Error('没有找到 Chrome 或 Edge，无法打开真实浏览器')
    mkdirSync(profileDir, { recursive: true })

    const reused = await CdpBrowserSession.#attach(await CdpBrowserSession.#reusablePort(profileDir), browser, profileDir)
    if (reused) return reused

    const port = await freePort()
    const child = spawn(browser, [
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${port}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      '--hide-crash-restore-bubble',
      '--disable-features=Translate,MediaRouter,OptimizationHints',
      '--window-size=1180,900',
      '--window-position=60,40',
      ...extraArgs,
      startUrl,
    ], { stdio: 'ignore' })

    let version = null
    for (let attempt = 0; attempt < 60 && !version; attempt += 1) {
      version = await readVersion(port, 1000)
      if (!version) await delay(500)
    }
    if (!version?.webSocketDebuggerUrl) {
      try { child.kill() } catch { /* 已退出 */ }
      throw new Error('Chrome 没有开放调试端口，可能是浏览器策略限制')
    }
    writeFileSync(path.join(profileDir, PORT_FILE), JSON.stringify({ port, pid: child.pid, executable: browser }), { mode: 0o600 })
    const session = await CdpBrowserSession.#attach(port, browser, profileDir, child)
    if (!session) throw new Error('无法连接 Chrome 调试通道')
    return session
  }

  static async #reusablePort(profileDir) {
    try {
      const info = JSON.parse(readFileSync(path.join(profileDir, PORT_FILE), 'utf8'))
      if (!info?.port) return 0
      const version = await readVersion(info.port)
      if (!version?.webSocketDebuggerUrl || !/Chrome\//.test(version.Browser || '')) return 0
      return info.port
    } catch { return 0 }
  }

  /** 复用已在运行的浏览器：抢到它已有的标签页，避免开出第二个窗口。 */
  static async #attach(port, browser, profileDir, child = null) {
    if (!port) return null
    const version = await readVersion(port)
    if (!version?.webSocketDebuggerUrl) return null
    let connection
    try {
      connection = await CdpConnection.connect(version.webSocketDebuggerUrl)
    } catch {
      return null
    }
    try {
      await connection.send('Target.setDiscoverTargets', { discover: true })
      // 刚启动的 Chrome 可能还没来得及提交地址，先等目标页面出现。
      let target = null
      const deadline = Date.now() + 6000
      while (Date.now() < deadline && !target) {
        const targets = await readTargets(port)
        target = targets.find((item) => isPageTarget(item) && item.url.includes('gemini.google.com')) || null
        if (!target) await delay(400)
      }
      if (!target) {
        const targets = await readTargets(port)
        target = targets.find(isPageTarget) || null
      }
      if (!target) {
        const created = await connection.send('Target.createTarget', { url: 'about:blank' })
        target = { id: created.targetId, url: 'about:blank' }
      }
      const { sessionId } = await connection.send('Target.attachToTarget', { targetId: target.id, flatten: true })
      const session = new CdpBrowserSession({ connection, targetId: target.id, sessionId, port, child, profileDir, url: target.url })
      await session.#prepare()
      return session
    } catch {
      connection.close()
      return null
    }
  }

  async #prepare() {
    await this.send('Page.enable')
    await this.send('Runtime.enable')
    await this.sendBrowser('Target.activateTarget', { targetId: this.targetId }).catch(() => {})
    // 标签页可能还停在 about:blank，等它落到真实地址，避免上层误判成“没登录”。
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      await this.refreshUrl()
      if (this.url && !this.url.startsWith('about:')) break
      await delay(300)
    }
    return this
  }

  /** 页面级命令（evaluate / 输入 / DOM）。 */
  send(method, params = {}) {
    return this.connection.send(method, params, this.sessionId)
  }

  /** 浏览器级命令（Target / Browser 域），不能带 sessionId。 */
  sendBrowser(method, params = {}) {
    return this.connection.send(method, params, undefined)
  }

  async evaluate(script) {
    let lastError = null
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const result = await this.send('Runtime.evaluate', { expression: script, returnByValue: true, awaitPromise: true })
        if (result?.exceptionDetails) {
          const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text || '页面脚本执行失败'
          throw new Error(String(description).split('\n')[0])
        }
        return result?.result?.value
      } catch (error) {
        lastError = error
        const message = String(error?.message || '')
        // 页面正在跳转时执行上下文会被销毁，等页面稳定后重试一次。
        if (!/context|destroyed|Cannot find|detached/i.test(message)) throw error
        await delay(400)
      }
    }
    throw lastError || new Error('页面脚本执行失败')
  }

  async refreshUrl() {
    try {
      const href = await this.evaluate('location.href')
      if (typeof href === 'string' && href) this.url = href
    } catch { /* 跳转中，保留旧值 */ }
    return this.url
  }

  isDestroyed() { return this.closed || this.connection.closed }

  async loadURL(url) {
    const result = await this.send('Page.navigate', { url })
    if (result?.errorText && !/ERR_ABORTED/.test(result.errorText)) throw new Error(result.errorText)
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      await delay(250)
      try {
        const state = await this.evaluate('document.readyState')
        if (state === 'complete' || state === 'interactive') break
      } catch { /* 还在跳转 */ }
    }
    await this.refreshUrl()
    return this
  }

  async show() {
    try {
      const { windowId } = await this.sendBrowser('Browser.getWindowForTarget', { targetId: this.targetId })
      await this.sendBrowser('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } }).catch(() => {})
    } catch { /* 窗口 API 不可用时忽略 */ }
    await this.sendBrowser('Target.activateTarget', { targetId: this.targetId }).catch(() => {})
    await this.send('Page.bringToFront').catch(() => {})
  }

  focus() { return this.show() }

  setMenuBarVisibility() { /* 真实浏览器由自己管理菜单栏 */ }

  on(event, callback) {
    if (event === 'closed') {
      this.closeCallbacks.add(callback)
      if (this.isDestroyed()) callback()
    }
  }

  async close() {
    try { await this.sendBrowser('Target.closeTarget', { targetId: this.targetId }) } catch { /* 目标已关闭 */ }
    this.connection.close()
    try { this.child?.kill() } catch { /* 已经退出 */ }
    this.#onClosed()
  }

  #onEvent(method, params, sessionId) {
    if (method === '__closed__') { this.#onClosed(); return }
    if (method === 'Target.targetCreated') { this.#handleNewTarget(params.targetInfo); return }
    // 用户手动关掉标签页后，会话已经没用了，交给上层重新开一个。
    if (method === 'Target.targetDestroyed') {
      if (params.targetId === this.targetId) this.#onClosed()
      return
    }
    if (sessionId !== this.sessionId) return
    if (method === 'Page.frameNavigated') {
      if (params.frame?.url && !params.frame.parentId) this.url = params.frame.url
    } else if (method === 'Page.navigatedWithinDocument') {
      if (params.url) this.url = params.url
    } else if (method === 'Page.fileChooserOpened' || method === 'Page.javascriptDialogOpening') {
      for (const listener of [...this.messageListeners]) {
        try { listener({}, method, params) } catch { /* 忽略 */ }
      }
    }
  }

  #handleNewTarget(info) {
    if (!info || info.targetId === this.targetId) return
    if (info.type !== 'page' && info.type !== 'tab') return
    const handler = this.windowOpenHandler
    if (!handler) return
    let decision = { action: 'allow' }
    try { decision = handler({ url: info.url }) || decision } catch { decision = { action: 'deny' } }
    if (decision.action === 'deny') {
      this.sendBrowser('Target.closeTarget', { targetId: info.targetId }).catch(() => {})
    }
  }

  #onClosed() {
    if (this.closed) return
    this.closed = true
    for (const callback of [...this.closeCallbacks]) {
      try { callback() } catch { /* 忽略 */ }
    }
  }
}
