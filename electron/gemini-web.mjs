import { BrowserWindow, shell } from 'electron'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { compileGeminiWebRequest } from '../server/gemini-web-request.mjs'
import { ConversationStore, conversationUrl } from './conversation-store.mjs'
import { CdpBrowserSession, findBrowserExecutable } from './cdp-browser.mjs'

const GEMINI_URL = 'https://gemini.google.com/app'
const EDITOR_SELECTOR = '[contenteditable="true"][role="textbox"], rich-textarea [contenteditable="true"], .ql-editor[contenteditable="true"], textarea'
const MODEL_BUTTON_SELECTOR = '[data-test-id="bard-mode-menu-button"], bard-mode-switcher button[aria-haspopup="true"], button[aria-label*="模式选择器"], button[aria-label*="model picker" i]'
const PREFERRED_GEMINI_MODEL = 'Argon'
/** 点击“登录”万一没跳转，就直接开这个地址，参数与 Gemini 自己用的一致。 */
const SIGN_IN_URL = 'https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fgemini.google.com%2Fapp&flowName=GlifWebSignIn&flowEntry=ServiceLogin'
const DEFAULT_ACCOUNT = process.env.PW_GEMINI_ACCOUNT || localAccount()
/** 内嵌窗口回退时才用，版本号取当前内核自己的，避免 UA 与真实内核对不上。 */
const CHROME_USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome || '148.0.0.0'} Safari/537.36`

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 自动填充用的 Google 账号不写进仓库：用 PW_GEMINI_ACCOUNT，或 %APPDATA%\PromptWizard\gemini-account.txt。 */
function localAccount() {
  try {
    return readFileSync(path.join(process.env.APPDATA || os.homedir(), 'PromptWizard', 'gemini-account.txt'), 'utf8').trim()
  } catch {
    return ''
  }
}

export class GeminiWebController {
  constructor({ icon, dataDir, browserProfileDir, browserExecutable }) {
    this.icon = icon
    this.window = null
    this.queue = Promise.resolve()
    this.conversations = new ConversationStore(dataDir)
    this.browserProfileDir = browserProfileDir || path.join(dataDir, 'gemini-browser-profile')
    this.browserExecutable = browserExecutable ?? ''
    this.fallbackReason = ''
  }

  async ensureWindow(show = false) {
    if (this.window && !this.window.isDestroyed()) {
      if (show) await this.window.show()
      return this.window
    }

    const win = await this.#openSession()
    this.window = win
    win.on('closed', () => { if (this.window === win) this.window = null })
    if (show) await win.show()
    return win
  }

  /**
   * 优先用真实 Chrome / Edge 承载会话。
   * Google 会拒绝 Electron 内嵌窗口登录（跳到 signin/rejected，提示
   * 「此浏览器或应用可能不安全」），伪造 UA 与 Client Hints 一样被拒，
   * 所以只有真实浏览器能完成登录并在此后长期保持会话。
   */
  async #openSession() {
    const executable = findBrowserExecutable(this.browserExecutable)
    if (!executable) {
      this.fallbackReason = '没有找到 Chrome 或 Edge'
      return this.#openEmbeddedWindow()
    }
    try {
      const session = await CdpBrowserSession.launch({
        profileDir: this.browserProfileDir,
        executable,
        startUrl: GEMINI_URL,
      })
      this.fallbackReason = ''
      return session
    } catch (error) {
      this.fallbackReason = error instanceof Error ? error.message : String(error)
      return this.#openEmbeddedWindow()
    }
  }

  async #openEmbeddedWindow() {
    const win = new BrowserWindow({
      width: 1180,
      height: 860,
      minWidth: 780,
      minHeight: 620,
      show: false,
      title: 'Gemini 网页对话',
      icon: this.icon,
      webPreferences: {
        partition: 'persist:promptwizard-gemini-web',
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    })
    win.setMenuBarVisibility(false)
    // Gemini serves Electron's branded user agent a non-interactive SSR shell.
    // A regular Chrome UA loads the same authenticated web app with working controls.
    win.webContents.setUserAgent(CHROME_USER_AGENT)
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isGoogleUrl(url)) return { action: 'allow' }
      void shell.openExternal(url)
      return { action: 'deny' }
    })
    await this.#loadGemini(win)
    return win
  }

  async status() {
    const win = await this.ensureWindow(false)
    const state = await win.webContents.executeJavaScript(`(() => {
      const visible = (node) => node && node.getClientRects().length > 0;
      const buttons = [...document.querySelectorAll('button,[role="button"],a')].filter(visible);
      const login = buttons.some((node) => /^(登录|Sign in)$/i.test((node.innerText || node.getAttribute('aria-label') || '').trim()));
      const editor = [...document.querySelectorAll(${JSON.stringify(EDITOR_SELECTOR)})].find(visible);
      const modelButton = document.querySelector(${JSON.stringify(MODEL_BUTTON_SELECTOR)});
      const accountNode = buttons.find((node) => /Google (账号|Account)/i.test(node.getAttribute('aria-label') || ''));
      const body = document.body ? document.body.innerText || '' : '';
      return {
        connected: location.hostname === 'gemini.google.com' && Boolean(editor) && !login,
        host: location.hostname,
        account: accountNode ? accountNode.getAttribute('aria-label') : '',
        model: modelButton ? (modelButton.innerText || modelButton.getAttribute('aria-label') || '').trim() : '',
        url: location.href,
        blocked: /此浏览器或应用可能不安全|may not be secure/i.test(body),
        signin: /(^|\.)accounts\.google\.com$/.test(location.hostname)
      };
    })()`)
    const connected = Boolean(state.connected)
    return {
      connected,
      account: String(state.account || ''),
      model: String(state.model || ''),
      engine: win instanceof CdpBrowserSession ? 'chrome' : 'embedded',
      url: String(state.url || ''),
      detail: connected
        ? `Gemini 网页已登录${state.model ? `，当前模式 ${state.model}` : ''}；提交时自动使用 Gemini 4 Argon`
        : state.blocked
          ? 'Google 拒绝了这个浏览器登录（此浏览器或应用可能不安全），请改用真实 Chrome / Edge 承载会话'
          : state.signin
            ? '正停留在 Google 登录页：请在窗口里输入密码完成登录'
            : this.fallbackReason
              ? `会话跑在内嵌窗口里（${this.fallbackReason}），请在其中登录 Google 账号`
              : '请在 Gemini 网页窗口登录 Google 账号',
    }
  }

  async openLogin(email = DEFAULT_ACCOUNT) {
    const win = await this.ensureWindow(false)
    await win.show()
    // 面板传进来的可能是账号显示名，只有像邮箱时才拿来填表；否则用本机账号文件。
    const address = /@/.test(String(email)) ? String(email).trim() : DEFAULT_ACCOUNT
    let state = await this.status()
    if (state.connected) {
      await win.show()
      return state
    }

    // 会话过期时窗口可能停在 Google 登录页；先回到 Gemini，再决定要不要点“登录”。
    if (!/^https:\/\/gemini\.google\.com/.test(state.url || '')) {
      await this.#loadGemini(win, GEMINI_URL)
      state = await this.status()
    }
    if (!state.connected) {
      await this.#clickSignIn(win)
      // 点完要等页面真的跳到 Google 登录页；刚重载时按钮还没渲染，这里一起兜住。
      const deadline = Date.now() + 10000
      while (Date.now() < deadline) {
        await delay(600)
        state = await this.status()
        if (state.connected || !/gemini\.google\.com/.test(state.url || '')) break
      }
      if (!state.connected && /gemini\.google\.com/.test(state.url || '')) {
        await this.#loadGemini(win, SIGN_IN_URL)
        state = await this.status()
      }
    }
    if (!state.connected && address) await this.#fillLoginEmail(win, address)
    await win.show()
    return this.status()
  }

  async #clickSignIn(win) {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      const clicked = await win.webContents.executeJavaScript(`(() => {
        const visible = (node) => node && node.getClientRects().length > 0;
        const label = (node) => (node.innerText || node.getAttribute('aria-label') || '').trim();
        const login = [...document.querySelectorAll('button,a')].find((node) => visible(node) && /^(登录|Sign in)$/i.test(label(node)));
        if (!login) return false;
        login.click();
        return true;
      })()`).catch(() => false)
      if (clicked) return true
      await delay(500)
    }
    return false
  }

  /**
   * Google 登录页的输入框是 input[name="identifier"]，不是 input[type="email"]，
   * 老版本按 type=email 找导致自动填充永远不生效。这里按当前页面结构填写并点“下一步”。
   */
  async #fillLoginEmail(win, email) {
    const deadline = Date.now() + 20000
    while (Date.now() < deadline) {
      const filled = await win.webContents.executeJavaScript(`(() => {
        const visible = (node) => node && node.getClientRects().length > 0;
        const field = [...document.querySelectorAll('input[name="identifier"], input[type="email"], input[type="text"], input[type="password"]')].find(visible);
        if (!field) return 'NO_FIELD';
        if (field.type === 'password') return 'PASSWORD';
        const value = ${JSON.stringify(String(email))};
        if ((field.value || '') === value) return 'ALREADY';
        field.focus();
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
        return 'FILLED';
      })()`).catch(() => 'RETRY')
      if (filled === 'PASSWORD') return 'password'
      if (filled === 'FILLED' || filled === 'ALREADY') {
        await delay(500)
        const clicked = await win.webContents.executeJavaScript(`(() => {
          const visible = (node) => node && node.getClientRects().length > 0;
          const next = [...document.querySelectorAll('button')].find((node) => visible(node) && /^(下一步|Next)$/i.test((node.innerText || '').trim()));
          if (!next) return false;
          next.click();
          return true;
        })()`).catch(() => false)
        if (clicked) await delay(2500)
        return clicked ? 'submitted' : 'filled'
      }
      await delay(500)
    }
    return 'timeout'
  }

  submit(body) {
    const run = () => this.#submit(body)
    const result = this.queue.then(run, run)
    this.queue = result.catch(() => {})
    return result
  }

  resetConversation(id) {
    const result = this.queue.then(() => this.conversations.reset(id))
    this.queue = result.catch(() => {})
    return result
  }

  async #submit(body) {
    const id = body?.conversationId
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error('缺少图片对话标识，请更新助手页面')
    const { prompt, images } = compileGeminiWebRequest(body?.messages)
    if (!prompt.trim()) throw new Error('没有可提交给 Gemini 网页的提示词')

    const win = await this.ensureWindow(true)
    const saved = this.conversations.get(id)
    const target = saved?.url || GEMINI_URL
    if (!saved || conversationUrl(win.webContents.getURL()) !== saved.url) await this.#loadGemini(win, target)
    await win.show()
    await this.#waitForEditor(win)

    if (saved && conversationUrl(win.webContents.getURL()) !== saved.url) {
      throw new Error('原 Gemini 对话不可访问（可能被删除或切换了账号），请点击“对话跑偏，重开”')
    }

    const state = await this.status()
    if (!state.connected) {
      throw new Error(`Gemini 网页尚未登录：${state.detail}${DEFAULT_ACCOUNT ? `（账号 ${DEFAULT_ACCOUNT}）` : ''}`)
    }

    await this.#selectGemini4(win)

    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'promptwizard-gemini-'))
    try {
      // 先检查草稿；不覆盖用户在同一窗口手动输入的内容。
      const hasDraft = await win.webContents.executeJavaScript(`(() => {
        const editor = [...document.querySelectorAll(${JSON.stringify(EDITOR_SELECTOR)})].find((node) => node.getClientRects().length > 0);
        return Boolean((editor?.value ?? editor?.innerText ?? '').trim());
      })()`)
      if (hasDraft) throw new Error('Gemini 输入框中有未发送内容，请先处理草稿，再重试')
      const files = []
      const uploaded = { ...(saved?.images || {}) }
      for (const image of images) {
        const digest = createHash('sha256').update(image.dataUrl).digest('hex')
        if (uploaded[image.name] === digest) continue
        const parsed = parseDataUrl(image.dataUrl)
        const filePath = path.join(tempDir, image.name.replace(/\.jpg$/i, parsed.ext))
        await writeFile(filePath, parsed.buffer)
        files.push(filePath)
        uploaded[image.name] = digest
      }

      if (files.length > 0) await this.#uploadFiles(win, files)
      await this.#fillPrompt(win, prompt)
      const before = await this.#latestResponse(win)
      // 提交前标记不确定状态；崩溃或超时后不会把半完成的一轮当作干净上下文。
      this.conversations.set(id, win.webContents.getURL(), true)
      await this.#send(win)
      const content = await this.#waitForResponse(win, before)
      await win.refreshUrl?.()
      const url = conversationUrl(win.webContents.getURL())
      if (!url) throw new Error('Gemini 未提供可恢复的对话链接，请关闭临时聊天后重试')
      this.conversations.set(id, url, false, uploaded)
      return content
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  async #waitForEditor(win) {
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      const found = await win.webContents.executeJavaScript(`Boolean([...document.querySelectorAll(${JSON.stringify(EDITOR_SELECTOR)})].find((node) => node.getClientRects().length > 0))`).catch(() => false)
      if (found) return
      await delay(500)
    }
    const state = await this.status().catch(() => null)
    if (state && !state.connected) throw new Error(`Gemini 网页无法提交：${state.detail}`)
    throw new Error('Gemini 网页加载超时，请检查网络后重试')
  }

  /** Gemini 4 网页版显示名为 Argon。每次提交前确认一次，避免旧对话仍停在 Flash。 */
  async #selectGemini4(win) {
    const readCurrent = () => win.webContents.executeJavaScript(`(() => {
      /* prompt-wizard:model-current */
      const button = document.querySelector(${JSON.stringify(MODEL_BUTTON_SELECTOR)});
      if (!button) return { found: false, current: '' };
      return { found: true, current: (button.innerText || button.getAttribute('aria-label') || '').trim() };
    })()`).catch(() => ({ found: false, current: '' }))

    let state = await readCurrent()
    if (!state.found || /(?:^|\\s)(?:4\\s*)?Argon(?:\\s|$)/i.test(state.current)) return state.current

    const opened = await win.webContents.executeJavaScript(`(() => {
      /* prompt-wizard:model-open */
      const button = document.querySelector(${JSON.stringify(MODEL_BUTTON_SELECTOR)});
      if (!button) return false;
      if (button.getAttribute('aria-expanded') !== 'true') button.click();
      return true;
    })()`).catch(() => false)
    if (!opened) return state.current

    let available = false
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const selection = await win.webContents.executeJavaScript(`(() => {
        /* prompt-wizard:model-option */
        const visible = (node) => node && node.getClientRects().length > 0;
        const label = (node) => (node.innerText || node.getAttribute('aria-label') || '').trim();
        const options = [...document.querySelectorAll('[data-test-id^="bard-mode-option-"], gem-menu-item, [role="menuitem"], [role="option"]')].filter(visible);
        const option = options.find((node) => /(?:^|\\s)(?:4\\s*)?Argon(?:\\s|$)/i.test(label(node)))
          || options.find((node) => /Gemini\\s*4/i.test(label(node)));
        if (!option) return { available: false, clicked: false };
        option.click();
        return { available: true, clicked: true, label: label(option) };
      })()`).catch(() => ({ available: false, clicked: false }))
      available ||= Boolean(selection.available)
      if (selection.clicked) break
      await delay(250)
    }

    if (!available) {
      throw new Error('当前 Gemini 账号的模式菜单中没有 Gemini 4 Argon，请确认账号权限或网页端是否已开放')
    }

    const confirmDeadline = Date.now() + 10000
    while (Date.now() < confirmDeadline) {
      await delay(300)
      state = await readCurrent()
      if (/(?:^|\\s)(?:4\\s*)?Argon(?:\\s|$)/i.test(state.current)) return PREFERRED_GEMINI_MODEL
    }
    throw new Error('已选择 Gemini 4 Argon，但网页没有完成模式切换，请刷新 Gemini 后重试')
  }

  async #loadGemini(win, url = GEMINI_URL) {
    try {
      await win.loadURL(url)
    } catch (error) {
      // Chromium 在登录跳转被页面接管时会报 ERR_ABORTED；只有最终仍在 Gemini 才能继续。
      await delay(500)
      if (!win.webContents.getURL().startsWith(GEMINI_URL)) throw error
    }
  }

  async #uploadFiles(win, files) {
    const debuggerApi = win.webContents.debugger
    if (!debuggerApi.isAttached()) debuggerApi.attach('1.3')
    if (await this.#setFilesOnPageInput(debuggerApi, files)) {
      await delay(1500)
      return
    }
    await debuggerApi.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true })

    try {
      const addRect = await win.webContents.executeJavaScript(`(() => {
        const visible = (node) => node && node.getClientRects().length > 0;
        const label = (node) => (node.innerText || node.getAttribute('aria-label') || '').trim();
        const nodes = [...document.querySelectorAll('*')].filter(visible);
        const add = [...document.querySelectorAll('button,[role="button"]')].find((node) => visible(node) && /上传和工具|添加文件|Upload and tools|Add files/i.test(label(node)))
          || nodes.find((node) => /上传和工具|添加文件|Upload and tools|Add files/i.test(label(node)))
          || nodes.find((node) => node.children.length === 0 && /^(plus|add)$/i.test((node.textContent || '').trim()));
        if (!add) return null;
        const target = add.closest('button,[role="button"],[tabindex]') || add;
        const rect = target.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`)
      if (!addRect) throw new Error('Gemini 网页上找不到“添加文件”按钮')
      await this.#clickAt(win, addRect)
      await delay(300)
      if (await this.#setFilesOnPageInput(debuggerApi, files)) {
        await delay(1500)
        return
      }

      const chooser = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          debuggerApi.removeListener('message', onMessage)
          reject(new Error('Gemini 没有打开文件选择器，请重新尝试'))
        }, 10000)
        const onMessage = async (_event, method, params) => {
          if (method !== 'Page.fileChooserOpened') return
          clearTimeout(timer)
          debuggerApi.removeListener('message', onMessage)
          try {
            await debuggerApi.sendCommand('DOM.enable')
            await debuggerApi.sendCommand('DOM.setFileInputFiles', {
              files,
              backendNodeId: params.backendNodeId,
            })
            resolve()
          } catch (error) {
            reject(error)
          }
        }
        debuggerApi.on('message', onMessage)
      })

      const uploadTarget = await win.webContents.executeJavaScript(`(() => {
        const visible = (node) => node && node.getClientRects().length > 0;
        const label = (node) => (node.innerText || node.getAttribute('aria-label') || '').trim();
        const matchesUpload = (node) => /^(上传文件|从设备上传|Upload files|Upload from device)(?:\\.|$)/i.test(label(node));
        const upload = [...document.querySelectorAll('[data-test-id="local-images-files-uploader-button"],button,[role="menuitem"],[role="button"],mat-list-item,li')].find((node) => visible(node) && matchesUpload(node))
          || [...document.querySelectorAll('*')].filter((node) => visible(node) && matchesUpload(node)).sort((a, b) => a.children.length - b.children.length)[0];
        if (upload) {
          const target = upload.closest('button,[role="menuitem"],[role="button"],[tabindex]') || upload;
          const rect = target.getBoundingClientRect();
          return { kind: 'rect', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
        const input = document.querySelector('input[type="file"]');
        if (input) { input.click(); return { kind: 'input' }; }
        return null;
      })()`)
      if (!uploadTarget) throw new Error('Gemini 的上传菜单中找不到“上传文件”')
      if (uploadTarget.kind === 'rect') await this.#clickAt(win, uploadTarget)
      await chooser
      await delay(1500)
    } finally {
      await debuggerApi.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {})
    }
  }

  async #setFilesOnPageInput(debuggerApi, files) {
    try {
      await debuggerApi.sendCommand('DOM.enable')
      const { root } = await debuggerApi.sendCommand('DOM.getDocument', { depth: -1, pierce: true })
      const { nodeIds = [] } = await debuggerApi.sendCommand('DOM.querySelectorAll', {
        nodeId: root.nodeId,
        selector: 'input[type="file"]',
      })
      if (nodeIds.length === 0) return false
      await debuggerApi.sendCommand('DOM.setFileInputFiles', { files, nodeId: nodeIds[0] })
      return true
    } catch {
      return false
    }
  }

  async #fillPrompt(win, prompt) {
    const focused = await win.webContents.executeJavaScript(`(() => {
      const visible = (node) => node && node.getClientRects().length > 0;
      const editor = [...document.querySelectorAll(${JSON.stringify(EDITOR_SELECTOR)})].find(visible);
      if (!editor) return false;
      editor.focus();
      return true;
    })()`)
    if (!focused) throw new Error('无法写入 Gemini 提示词输入框')
    await win.webContents.insertText(prompt)
    await delay(300)
  }

  async #send(win) {
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      const state = await win.webContents.executeJavaScript(`(() => {
        const visible = (node) => node && node.getClientRects().length > 0;
        const label = (node) => (node.getAttribute('aria-label') || node.innerText || '').trim();
        const editor = [...document.querySelectorAll(${JSON.stringify(EDITOR_SELECTOR)})].find(visible);
        if (!editor) return null;
        editor.focus();
        const send = [...document.querySelectorAll('button[aria-label="发送"],button[aria-label="Send"],button')].find((node) => visible(node) && !node.disabled && /^(发送消息|发送|Send message|Send)$/i.test(label(node)));
        const icon = [...document.querySelectorAll('[data-mat-icon-name="arrow_upward"],[fonticon="arrow_upward"],*')].find((node) => visible(node) && node.children.length === 0 && /^(arrow_upward|send)$/i.test((node.textContent || node.getAttribute('data-mat-icon-name') || node.getAttribute('fonticon') || '').trim()));
        const iconButton = icon?.closest('button');
        const target = send || (iconButton && !iconButton.disabled ? iconButton : null);
        if (!target) return { rect: null };
        const bounds = target.getBoundingClientRect();
        return { rect: { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 } };
      })()`)
      if (!state?.rect) {
        await delay(500)
        continue
      }

      await this.#clickAt(win, state.rect)
      await delay(500)
      const cleared = await win.webContents.executeJavaScript(`(() => {
        const visible = (node) => node && node.getClientRects().length > 0;
        const editor = [...document.querySelectorAll(${JSON.stringify(EDITOR_SELECTOR)})].find(visible);
        return Boolean(editor && ((editor.value ?? editor.innerText ?? '').trim() === ''));
      })()`)
      if (cleared) return

      await win.webContents.executeJavaScript(`(() => {
        const editor = [...document.querySelectorAll(${JSON.stringify(EDITOR_SELECTOR)})].find((node) => node.getClientRects().length > 0);
        editor?.focus();
      })()`)
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
      await delay(500)
      const clearedByEnter = await win.webContents.executeJavaScript(`(() => {
        const editor = [...document.querySelectorAll(${JSON.stringify(EDITOR_SELECTOR)})].find((node) => node.getClientRects().length > 0);
        return Boolean(editor && ((editor.value ?? editor.innerText ?? '').trim() === ''));
      })()`)
      if (clearedByEnter) return
    }
    throw new Error('Gemini 图片仍在处理或发送按钮不可用，请稍后重试')
  }

  async #clickAt(win, rect) {
    const x = Math.max(0, Math.round(rect.x))
    const y = Math.max(0, Math.round(rect.y))
    win.webContents.sendInputEvent({ type: 'mouseMove', x, y })
    win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
    await delay(200)
  }

  async #latestResponse(win) {
    return win.webContents.executeJavaScript(`(() => {
      const selectors = ['model-response', '[data-test-id="model-response"]', 'structured-content-container', '.model-response-text', 'message-content'];
      // 历史消息可能移出视口；不能用可见数量来判断有没有新增回复。
      const nodes = selectors.map((selector) => [...document.querySelectorAll(selector)].filter((node) =>
        !node.closest('user-query,user-message')
      )).find((items) => items.length) || [];
      const last = nodes[nodes.length - 1];
      if (last && !last.dataset.promptWizardTurn) last.dataset.promptWizardTurn = crypto.randomUUID();
      const output = last?.querySelector('structured-content-container, .model-response-text, message-content') || last;
      return { count: nodes.length, id: last?.dataset.promptWizardTurn || '', text: (output?.innerText || '').trim() };
    })()`)
  }

  async #waitForResponse(win, before) {
    const deadline = Date.now() + 180000
    let last = ''
    let stable = 0
    while (Date.now() < deadline) {
      const current = await this.#latestResponse(win)
      const generating = await win.webContents.executeJavaScript(`(() => {
        const visible = (node) => node && node.getClientRects().length > 0;
        return [...document.querySelectorAll('button')].some((node) => visible(node) && /停止回答|停止生成|Stop response|Stop generating/i.test(node.getAttribute('aria-label') || node.innerText || ''));
      })()`)
      if (current.text && (current.count > before.count || current.id !== before.id)) {
        stable = current.text === last ? stable + 1 : 0
        last = current.text
        if (!generating && stable >= 2) return current.text
      }
      await delay(1000)
    }
    throw new Error(last ? 'Gemini 回复生成超时，可在网页窗口查看未完成内容' : '没有抓取到 Gemini 网页回复')
  }
}

function isGoogleUrl(value) {
  try {
    const host = new URL(value).hostname
    return host === 'gemini.google.com' || host.endsWith('.google.com') || host.endsWith('.googleusercontent.com')
  } catch {
    return false
  }
}

function parseDataUrl(value) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([\s\S]+)$/i.exec(value)
  if (!match) throw new Error('图片附件不是可上传的 JPEG、PNG 或 WebP')
  const ext = match[1].toLowerCase() === 'image/png' ? '.png' : match[1].toLowerCase() === 'image/webp' ? '.webp' : '.jpg'
  return { buffer: Buffer.from(match[2], 'base64'), ext }
}
