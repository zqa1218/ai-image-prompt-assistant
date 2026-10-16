import { BrowserWindow, shell } from 'electron'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { compileGeminiWebRequest } from '../server/gemini-web-request.mjs'
import { modelMatcher, resolvePlan } from '../server/gemini-plans.mjs'
import { inspectMode, ensureMode } from './gemini-mode.mjs'
import { ConversationStore, conversationUrl } from './conversation-store.mjs'
import { CdpBrowserSession, findBrowserExecutable } from './cdp-browser.mjs'

const GEMINI_URL = 'https://gemini.google.com/app'
const EDITOR_SELECTOR = '[contenteditable="true"][role="textbox"], rich-textarea [contenteditable="true"], .ql-editor[contenteditable="true"], textarea'
const IMAGE_FILE_INPUT_SELECTOR = 'input[type="file"][accept*="image"]'
const MODEL_BUTTON_SELECTOR = '[data-test-id="bard-mode-menu-button"], bard-mode-switcher button[aria-haspopup="true"], button[aria-label*="模式选择器"], button[aria-label*="model picker" i]'
/** 误判拒绝只回一句很短的能力否认；长回答里出现同类措辞不算。 */
const REFUSAL_MAX_LENGTH = 240
const REFUSAL_MARKERS = [
  '我只是一个语言模型',
  '我只是语言模型',
  '我只是一个文本',
  '我只会生成文本',
  '超出了我的程序逻辑范畴',
  '爱莫能助',
  '没法帮上',
  '没法帮到',
  '没法帮你',
  '无法提供这方面的帮助',
  '不能理解或回复你的这个问题',
  'I am just a language model',
  'I\u2019m just a language model',
  "I'm just a language model",
]
/** 思考等级：低点 / 中等 / 高点。默认不碰，跟随账号自己的设置。 */
const THINKING_LEVEL = (process.env.PW_GEMINI_THINKING || '').trim()
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
        ? `Gemini 网页已登录${state.model ? `，当前模型 ${state.model}` : ''}；严格使用所选方案，失败时不换模型`
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
    const plan = resolvePlan(body?.geminiPlan)
    const { prompt, images } = compileGeminiWebRequest(body?.messages)
    if (!prompt.trim()) throw new Error('没有可提交给 Gemini 网页的提示词')

    const win = await this.ensureWindow(true)
    const previous = this.conversations.get(id)
    const saved = previous?.plan === plan.id ? previous : null
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

    const thinking = String(body?.geminiThinking ?? THINKING_LEVEL).trim()

    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'promptwizard-gemini-'))
    try {
      // 先检查草稿；不覆盖用户在同一窗口手动输入的内容。
      const hasDraft = await win.webContents.executeJavaScript(`(() => {
        const editor = [...document.querySelectorAll(${JSON.stringify(EDITOR_SELECTOR)})].find((node) => node.getClientRects().length > 0);
        return Boolean((editor?.value ?? editor?.innerText ?? '').trim());
      })()`)
      if (hasDraft) throw new Error('Gemini 输入框中有未发送内容，请先处理草稿，再重试')
      await this.#ensureMode(win, plan.mode)
      await this.#selectModel(win, modelMatcher(plan.model))
      if (thinking) await this.#selectThinking(win, thinking)
      await this.#ensureMode(win, plan.mode)
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
      this.conversations.set(id, win.webContents.getURL(), true, {}, plan.id)
      // Uploading can rebuild the composer. Reapply the same plan, then keep it
      // locked while locating and clicking Send; no different plan is tried.
      await this.#ensureMode(win, plan.mode)
      await this.#selectModel(win, modelMatcher(plan.model))
      await this.#send(win, plan)
      const content = await this.#waitForResponse(win, before)
      if (isRefusalReply(content)) throw new Error(`${plan.label} 未完成请求，未切换模型。网页回复：${content}`)
      await win.refreshUrl?.()
      const url = conversationUrl(win.webContents.getURL())
      if (!url) throw new Error('Gemini 未提供可恢复的对话链接，请在网页中查看结果')
      this.conversations.set(id, url, false, uploaded, plan.id)
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

  /** Wait through composer rerenders; final pre-send verification is read-only. */
  async #ensureMode(win, mode, change = true) {
    return ensureMode(allowClick => win.webContents.executeJavaScript(
      `/* prompt-wizard:chat-mode */ (${inspectMode.toString()})(${JSON.stringify(mode)}, ${JSON.stringify(allowClick)})`
    ), mode, { change })
  }

  /** 网页端模型名带版本号和副标题，按候选的 includes/excludes 子串匹配来选，别写死版本号。 */
  async #selectModel(win, candidate) {
    const readCurrent = () => win.webContents.executeJavaScript(`(() => {
      /* prompt-wizard:model-current */
      const button = document.querySelector(${JSON.stringify(MODEL_BUTTON_SELECTOR)});
      if (!button) return { found: false, current: '' };
      return { found: true, current: (button.innerText || button.getAttribute('aria-label') || '').trim() };
    })()`).catch(() => ({ found: false, current: '' }))

    // 导航回首页后模型按钮可能晚于输入框渲染，给页面一点时间，别把“还没画完”当成失败。
    let state = await readCurrent()
    const buttonDeadline = Date.now() + 10000
    while (!state.found && Date.now() < buttonDeadline) {
      await delay(300)
      state = await readCurrent()
    }
    if (!state.found) throw new Error(`无法确认当前 Gemini 模型，已停止发送（所选 ${candidate.name}）`)
    if (matchesModel(candidate, state.current)) return state.current

    const opened = await win.webContents.executeJavaScript(`(() => {
      /* prompt-wizard:model-open */
      const button = document.querySelector(${JSON.stringify(MODEL_BUTTON_SELECTOR)});
      if (!button) return false;
      if (button.getAttribute('aria-expanded') !== 'true') button.click();
      return true;
    })()`).catch(() => false)
    if (!opened) throw new Error(`无法打开模型菜单，已停止发送（所选 ${candidate.name}）`)

    let available = false
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const selection = await win.webContents.executeJavaScript(`(() => {
        /* prompt-wizard:model-option */
        const visible = (node) => node && node.getClientRects().length > 0;
        const label = (node) => (node.innerText || node.getAttribute('aria-label') || '').trim();
        const options = [...document.querySelectorAll('[data-test-id^="bard-mode-option-"], gem-menu-item, [role="menuitem"], [role="option"], [role="menuitemradio"], [role="radio"]')].filter(visible);
        const target = ${JSON.stringify({ includes: candidate.includes, excludes: candidate.excludes })};
        const hit = (text) => {
          const value = String(text || '').toLowerCase();
          return target.includes.every((needle) => value.includes(needle.toLowerCase()))
            && !target.excludes.some((needle) => value.includes(needle.toLowerCase()));
        };
        const option = options.find((node) => hit(label(node)));
        if (!option) return { available: false, clicked: false };
        option.click();
        return { available: true, clicked: true, label: label(option) };
      })()`).catch(() => ({ available: false, clicked: false }))
      available ||= Boolean(selection?.available)
      if (selection?.clicked) break
      await delay(250)
    }

    if (!available) {
      await this.#closeModelMenu(win)
      const error = new Error(`当前 Gemini 账号的模式菜单里没有 ${candidate.name} 模型，请确认账号权限或网页端是否已开放`)
      error.modelUnavailable = true
      throw error
    }

    const confirmDeadline = Date.now() + 10000
    while (Date.now() < confirmDeadline) {
      await delay(300)
      state = await readCurrent()
      if (matchesModel(candidate, state.current)) return state.current
    }
    await this.#closeModelMenu(win)
    throw new Error(`Gemini 网页没有完成模式切换（目标 ${candidate.name}），请刷新 Gemini 后重试`)
  }

  /** 思考等级在模式菜单的二级菜单里；只有显式配置了 PW_GEMINI_THINKING 才会动它。 */
  async #selectThinking(win, level) {
    if (!(await this.#openModelMenu(win))) return ''
    const entry = await win.webContents.executeJavaScript(`(() => {
      /* prompt-wizard:thinking-open */
      const visible = (node) => node && node.getClientRects().length > 0;
      const label = (node) => (node.innerText || node.getAttribute('aria-label') || '').trim();
      const item = [...document.querySelectorAll('[role="menuitem"], gem-menu-item')].filter(visible)
        .find((node) => label(node).startsWith('思考等级'));
      if (!item) return false;
      item.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      item.click();
      return true;
    })()`).catch(() => false)
    if (!entry) { await this.#closeModelMenu(win); return '' }

    let current = ''
    const deadline = Date.now() + 6000
    while (Date.now() < deadline) {
      const picked = await win.webContents.executeJavaScript(`(() => {
        /* prompt-wizard:thinking-option */
        const visible = (node) => node && node.getClientRects().length > 0;
        const label = (node) => (node.innerText || node.getAttribute('aria-label') || '').trim();
        const options = [...document.querySelectorAll('[role="menuitemradio"], [role="radio"], [role="menuitem"], gem-menu-item')].filter(visible)
          .filter((node) => /^(低点|中等|高点)/.test(label(node)));
        const option = options.find((node) => label(node).startsWith(${JSON.stringify(level)}));
        if (!option) return { picked: '', already: '' };
        const already = options.find((node) => String(node.className).includes('selected'));
        if (already && label(already).startsWith(${JSON.stringify(level)})) return { picked: '', already: label(already) };
        option.click();
        return { picked: label(option), already: '' };
      })()`).catch(() => ({ picked: '', already: '' }))
      current = picked?.picked || picked?.already || ''
      if (current || picked?.picked) break
      await delay(250)
    }
    await this.#closeModelMenu(win)
    return current
  }

  async #openModelMenu(win) {
    return win.webContents.executeJavaScript(`(() => {
      /* prompt-wizard:model-open */
      const button = document.querySelector(${JSON.stringify(MODEL_BUTTON_SELECTOR)});
      if (!button) return false;
      if (button.getAttribute('aria-expanded') !== 'true') button.click();
      return true;
    })()`).catch(() => false)
  }

  async #closeModelMenu(win) {
    await win.webContents.executeJavaScript('document.body.click()').catch(() => {})
    await delay(300)
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
      if (await this.#uploadedWithin(win, files.length, 20000)) return
    }
    await debuggerApi.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true })

    try {
      let lastError = null
      for (let attempt = 0; attempt < 3; attempt += 1) {
        // 上一轮留下的浮层（模型菜单、上传菜单）会吃掉点击：确认没开着，再打开“+”。
        if (!(await this.#uploadMenuOpen(win))) {
          await this.#dismissOverlays(win)
          // 浏览器窗口被挡在后面时页面是 hidden，坐标点击会被 Chrome 丢掉；
          // 先用元素自身的 click() 打开菜单，失败或重试时再补一次坐标点击。
          const opened = await this.#openUploadMenu(win)
          if (!opened || attempt > 0) {
            const addRect = await this.#findAddButton(win)
            if (!addRect) throw new Error('Gemini 网页上找不到“添加文件”按钮')
            await this.#clickAt(win, addRect)
          }
        }

        // Gemini 4 要先点开“上传和工具”才会挂出隐藏的图片 input，直接塞文件最稳；
        // 找不到时再退回“点菜单项 + 接管文件选择器”。
        let menuItem = null
        let pushed = false
        const menuDeadline = Date.now() + 8000
        while (Date.now() < menuDeadline) {
          if (await this.#setFilesOnPageInput(debuggerApi, files)) {
            pushed = true
            break
          }
          menuItem = await this.#findUploadMenuItem(win)
          if (menuItem) break
          await delay(250)
        }

        if (pushed) {
          if (await this.#uploadedWithin(win, files.length, 20000)) return
          lastError = new Error('图片已提交给 Gemini，但附件预览没有出现，请检查网络后重试')
          await this.#dismissOverlays(win)
          continue
        }

        if (!menuItem) {
          lastError = new Error('Gemini 的上传菜单中找不到“上传文件”')
          await this.#dismissOverlays(win)
          continue
        }

        // 先挂监听再点菜单项，避免文件选择器事件早于监听到达。
        const chooser = this.#armFileChooser(debuggerApi, files)
        await this.#clickAt(win, menuItem)
        if (await chooser) {
          if (await this.#uploadedWithin(win, files.length, 20000)) return
        }
        if (await this.#setFilesOnPageInput(debuggerApi, files)) {
          if (await this.#uploadedWithin(win, files.length, 20000)) return
        }
        lastError = new Error('Gemini 没有打开文件选择器，请重新尝试')
        await this.#dismissOverlays(win)
      }
      throw lastError ?? new Error('Gemini 图片上传失败，请重新尝试')
    } finally {
      await debuggerApi.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {})
    }
  }

  /**
   * “上传和工具”菜单已经展开时，再点一次“+”只会把它关掉；先看状态再决定点不点。
   * 新版 Gemini 的菜单项没有稳定的 data-test-id，文案也可能只在 innerText 或 textContent 之一，
   * 所以三个来源都读一遍，别把没拿到文案当成菜单没开。
   */
  async #uploadMenuOpen(win) {
    return win.webContents.executeJavaScript(`(() => {
      /* prompt-wizard:upload-menu-open */
      const visible = (node) => node && node.getClientRects().length > 0;
      const label = (node) => (node.getAttribute('aria-label') || node.innerText || node.textContent || '').trim();
      const matches = (node) => /^(上传文件|从设备上传|Upload files|Upload from device)(?:\\.|$)/i.test(label(node));
      return [...document.querySelectorAll('*')].some((node) => visible(node) && matches(node));
    })()`).catch(() => false)
  }

  /**
   * 用元素自身的 click() 打开“上传和工具”菜单。
   * 坐标点击要求页面处于可见状态，窗口被挡住时 Chrome 会直接丢弃合成鼠标事件。
   */
  async #openUploadMenu(win) {
    return win.webContents.executeJavaScript(`(() => {
      /* prompt-wizard:open-upload-menu */
      const visible = (node) => node && node.getClientRects().length > 0;
      const label = (node) => (node.getAttribute('aria-label') || node.innerText || node.textContent || '').trim();
      const nodes = [...document.querySelectorAll('*')].filter(visible);
      const add = [...document.querySelectorAll('button,[role="button"]')].find((node) => visible(node) && /上传和工具|添加文件|Upload and tools|Add files/i.test(label(node)))
        || nodes.find((node) => /上传和工具|添加文件|Upload and tools|Add files/i.test(label(node)))
        || nodes.find((node) => node.children.length === 0 && /^(plus|add)$/i.test((node.textContent || '').trim()));
      if (!add) return false;
      const target = add.closest('button,[role="button"],[tabindex]') || add;
      target.click();
      return true;
    })()`).catch(() => false)
  }

  async #findAddButton(win) {
    return win.webContents.executeJavaScript(`(() => {
      /* prompt-wizard:add-file-button */
      const visible = (node) => node && node.getClientRects().length > 0;
      const label = (node) => (node.getAttribute('aria-label') || node.innerText || node.textContent || '').trim();
      const nodes = [...document.querySelectorAll('*')].filter(visible);
      const add = [...document.querySelectorAll('button,[role="button"]')].find((node) => visible(node) && /上传和工具|添加文件|Upload and tools|Add files/i.test(label(node)))
        || nodes.find((node) => /上传和工具|添加文件|Upload and tools|Add files/i.test(label(node)))
        || nodes.find((node) => node.children.length === 0 && /^(plus|add)$/i.test((node.textContent || '').trim()));
      if (!add) return null;
      const target = add.closest('button,[role="button"],[tabindex]') || add;
      const rect = target.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`).catch(() => null)
  }

  async #findUploadMenuItem(win) {
    return win.webContents.executeJavaScript(`(() => {
      /* prompt-wizard:upload-menu-item */
      const visible = (node) => node && node.getClientRects().length > 0;
      const label = (node) => (node.getAttribute('aria-label') || node.innerText || node.textContent || '').trim();
      const matchesUpload = (node) => /^(上传文件|从设备上传|Upload files|Upload from device)(?:\\.|$)/i.test(label(node));
      const upload = [...document.querySelectorAll('[data-test-id="local-images-files-uploader-button"],button,[role="menuitem"],[role="button"],mat-list-item,li')].find((node) => visible(node) && matchesUpload(node))
        || [...document.querySelectorAll('*')].filter((node) => visible(node) && matchesUpload(node)).sort((a, b) => a.children.length - b.children.length)[0];
      if (!upload) return null;
      const target = upload.closest('button,[role="menuitem"],[role="button"],[tabindex]') || upload;
      const rect = target.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`).catch(() => null)
  }

  /** 关掉可能挡在“+”前面的浮层。Escape 必须走 CDP 原生命令，别用只认回车的 sendInputEvent。 */
  async #dismissOverlays(win) {
    await win.webContents.executeJavaScript(`(() => { document.body.click(); return true })()`).catch(() => {})
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
    }).catch(() => {})
    await delay(500)
  }

  /** 点“上传文件”后 Chrome 会打开文件选择器；事件早于轮询返回，必须先挂监听再接住。 */
  #armFileChooser(debuggerApi, files) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        debuggerApi.removeListener('message', onMessage)
        resolve(false)
      }, 10000)
      const onMessage = async (_event, method, params) => {
        if (method !== 'Page.fileChooserOpened') return
        clearTimeout(timer)
        debuggerApi.removeListener('message', onMessage)
        try {
          await debuggerApi.sendCommand('DOM.enable')
          await debuggerApi.sendCommand('DOM.setFileInputFiles', { files, backendNodeId: params.backendNodeId })
          resolve(true)
        } catch {
          resolve(false)
        }
      }
      debuggerApi.on('message', onMessage)
    })
  }

  async #uploadedWithin(win, expected, timeout) {
    try {
      await this.#waitForUploadedFiles(win, expected, timeout)
      return true
    } catch {
      return false
    }
  }

  async #setFilesOnPageInput(debuggerApi, files) {
    try {
      await debuggerApi.sendCommand('DOM.enable')
      const { root } = await debuggerApi.sendCommand('DOM.getDocument', { depth: -1, pierce: true })
      const { nodeIds = [] } = await debuggerApi.sendCommand('DOM.querySelectorAll', {
        nodeId: root.nodeId,
        selector: IMAGE_FILE_INPUT_SELECTOR,
      })
      if (nodeIds.length === 0) return false
      await debuggerApi.sendCommand('DOM.setFileInputFiles', { files, nodeId: nodeIds[0] })
      return true
    } catch {
      return false
    }
  }

  async #waitForUploadedFiles(win, expected, timeout = 30000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const count = await win.webContents.executeJavaScript(`(() => {
        /* prompt-wizard:uploaded-files */
        const visible = (node) => node && node.getClientRects().length > 0;
        const attachments = [...document.querySelectorAll('uploader-file-preview gem-media-attachment')].filter(visible);
        return attachments.length || [...document.querySelectorAll('uploader-file-preview-container img[alt="attachment"]')].filter(visible).length;
      })()`).catch(() => 0)
      if (count >= expected) return
      await delay(250)
    }
    throw new Error(`图片已交给 Gemini 网页，但附件预览未在 ${Math.round(timeout / 1000)} 秒内出现，请检查网络后重试`)
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

  async #send(win, plan) {
    const candidate = modelMatcher(plan.model)
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      const state = await win.webContents.executeJavaScript(`(() => {
        /* prompt-wizard:guarded-send */
        const visible = (node) => node && node.getClientRects().length > 0;
        const label = (node) => (node.getAttribute('aria-label') || node.innerText || '').trim();
        const mode = (${inspectMode.toString()})(${JSON.stringify(plan.mode)}, false);
        const modelButton = document.querySelector(${JSON.stringify(MODEL_BUTTON_SELECTOR)});
        const model = (modelButton?.innerText || modelButton?.getAttribute('aria-label') || '').trim();
        const candidate = ${JSON.stringify({ includes: candidate.includes, excludes: candidate.excludes })};
        const normalizedModel = model.toLowerCase();
        const modelMatches = candidate.includes.every((part) => normalizedModel.includes(part.toLowerCase()))
          && !candidate.excludes.some((part) => normalizedModel.includes(part.toLowerCase()));
        if (mode !== 'selected' || !modelMatches) return { mode, model, clicked: false };
        const editor = [...document.querySelectorAll(${JSON.stringify(EDITOR_SELECTOR)})].find(visible);
        if (!editor) return { mode, model, clicked: false };
        editor.focus();
        const send = [...document.querySelectorAll('button[aria-label="发送"],button[aria-label="Send"],button')].find((node) => visible(node) && !node.disabled && /^(发送消息|发送|Send message|Send)$/i.test(label(node)));
        const icon = [...document.querySelectorAll('[data-mat-icon-name="arrow_upward"],[fonticon="arrow_upward"],*')].find((node) => visible(node) && node.children.length === 0 && /^(arrow_upward|send)$/i.test((node.textContent || node.getAttribute('data-mat-icon-name') || node.getAttribute('fonticon') || '').trim()));
        const iconButton = icon?.closest('button');
        const target = send || (iconButton && !iconButton.disabled ? iconButton : null);
        if (!target) return { mode, model, clicked: false };
        target.click();
        return { mode, model, clicked: true };
      })()`)
      if (state?.mode !== 'selected') {
        await this.#ensureMode(win, plan.mode)
        continue
      }
      if (!matchesModel(candidate, state?.model)) {
        await this.#selectModel(win, candidate)
        continue
      }
      if (!state?.clicked) {
        await delay(500)
        continue
      }
      await delay(500)
      const cleared = await win.webContents.executeJavaScript(`(() => {
        const visible = (node) => node && node.getClientRects().length > 0;
        const editor = [...document.querySelectorAll(${JSON.stringify(EDITOR_SELECTOR)})].find(visible);
        return Boolean(editor && ((editor.value ?? editor.innerText ?? '').trim() === ''));
      })()`)
      if (cleared) return

      // Retry the guarded button click instead of an unguarded Enter fallback.
    }
    throw new Error(`Gemini 未能在确认 ${plan.label} 的状态下发送，请检查网页是否仍可操作`)
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
      if (!output) return { count: nodes.length, id: last?.dataset.promptWizardTurn || '', text: '' };
      // Gemini 会在引用附件的段落下挂“JPG +2”这类来源角标；它们是界面标注，会混进提示词正文。
      const chips = [...output.querySelectorAll('.source-label-container, .source-label, sources-list, .sources-list')];
      const previous = chips.map((node) => node.style.display);
      chips.forEach((node) => { node.style.display = 'none'; });
      const text = (output.innerText || '').trim();
      chips.forEach((node, index) => { node.style.display = previous[index]; });
      return { count: nodes.length, id: last?.dataset.promptWizardTurn || '', text };
    })()`)
  }

  async #waitForResponse(win, before) {
    const deadline = Date.now() + 180000
    let last = ''
    let stable = 0
    let imageTurns = 0
    while (Date.now() < deadline) {
      const current = await this.#latestResponse(win)
      const state = await this.#generationState(win)
      // 带图请求被误解成「帮我改图」时，Gemini 会去生成图片：正文一直是空的，
      // 只有「正在创建您的图片」。等满三分钟没有意义，早点停下来说明原因。
      if (state.image && (!current.text || isPendingReply(current.text))) {
        imageTurns += 1
        if (imageTurns >= 6) {
          await this.#stopGenerating(win)
          throw new Error('Gemini 把这次请求误判成「生成图片」，已停止这次生成；请点「重跑」再试')
        }
      } else {
        imageTurns = 0
      }
      if (current.text && (current.count > before.count || current.id !== before.id)) {
        // 任务模式先渲染「正在深入思考…」这类状态，它同样会稳定两秒，不能当成最终回复。
        if (isPendingReply(current.text)) {
          stable = 0
          last = ''
          await delay(1000)
          continue
        }
        stable = current.text === last ? stable + 1 : 0
        last = current.text
        if (!state.generating && stable >= 2) return current.text
      }
      await delay(1000)
    }
    throw new Error(last ? 'Gemini 回复生成超时，可在网页窗口查看未完成内容' : '没有抓取到 Gemini 网页回复')
  }

  /** 网页当前是否在生成，以及生成的是不是图片而不是文字回答。 */
  async #generationState(win) {
    return win.webContents.executeJavaScript(`(() => {
      /* prompt-wizard:generation-state */
      const visible = (node) => node && node.getClientRects().length > 0;
      const label = (node) => (node.getAttribute('aria-label') || node.innerText || '').trim();
      const stop = [...document.querySelectorAll('button')].some((node) => visible(node) && ${STOP_BUTTON_PATTERN_SOURCE}.test(label(node)));
      if (!stop) return { generating: false, image: false };
      const nodes = [...document.querySelectorAll('model-response, [data-test-id="model-response"]')];
      const scope = String(nodes[nodes.length - 1]?.innerText || '') + ' ' + (document.body.innerText || '');
      return { generating: true, image: ${IMAGE_CREATION_PATTERN_SOURCE}.test(scope) };
    })()`).catch(() => ({ generating: false, image: false }))
  }

  /** 误判成生成图片时点网页自己的停止按钮，别让它在后台继续跑几分钟。 */
  async #stopGenerating(win) {
    return win.webContents.executeJavaScript(`(() => {
      /* prompt-wizard:stop-generating */
      const visible = (node) => node && node.getClientRects().length > 0;
      const label = (node) => (node.getAttribute('aria-label') || node.innerText || '').trim();
      const stop = [...document.querySelectorAll('button')].find((node) => visible(node) && ${STOP_BUTTON_PATTERN_SOURCE}.test(label(node)));
      if (!stop) return false;
      stop.click();
      return true;
    })()`).catch(() => false)
  }
}

/** 生成中才会出现的停止按钮；只有它可见时才说明网页正在跑。 */
const STOP_BUTTON_PATTERN_SOURCE = String.raw`/^(停止|停止回答|停止生成|停止生成回复|Stop|Stop response|Stop generating)(\s|$)/i`
/** 生成图片的进度文案是临时的，生成完就消失，不会把历史里的图片误判成正在生成。 */
const IMAGE_CREATION_PATTERN_SOURCE = String.raw`/正在创建您的图片|正在创建图片|正在生成图片|正在制作图片|Creating your image|Generating your image/i`

/** 菜单项的文案里带版本号和副标题，用候选自己的 includes/excludes 子串判断，避免写死版本号。 */
function matchesModel(candidate, text) {
  const value = String(text || '').toLowerCase()
  if (!value) return false
  if (!candidate.includes.every((needle) => value.includes(String(needle).toLowerCase()))) return false
  return !candidate.excludes.some((needle) => value.includes(String(needle).toLowerCase()))
}

/**
 * 网页端偶尔把「整段固定规则 + 图片」当成看不懂的请求，只回一句短拒答。
 * 将短能力否认报告为失败，不自动改用其他模型。
 */
/** 任务模式的状态占位（「正在深入思考…」「思考完毕 Gemini 说」）不是回复内容。 */
const PENDING_MARKERS = /正在深入思考|深入思考中|正在思考|正在生成|思考中|思考完毕|规划步骤|Thinking|Gemini 说|已完成/g
function isPendingReply(text) {
  const rest = String(text || '').replace(PENDING_MARKERS, '').replace(/[\s…。．.,，:：]+/g, '')
  return rest.length === 0
}

function isRefusalReply(text) {
  const value = String(text || '').trim()
  if (!value) return true
  if (value.length > REFUSAL_MAX_LENGTH) return false
  return REFUSAL_MARKERS.some((marker) => value.includes(marker))
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
