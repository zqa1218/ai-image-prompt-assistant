/**
 * ChatGPT 网页通道：把「Skill + 需求 + 底图 + 参考图」提交到 chatgpt.com，
 * 抓回纯文字提示词。对外接口与 GeminiWebController 保持一致，
 * 这样 server/index.mjs 只按设置里的 mode 分派，前端不用区分渠道。
 *
 * 与 Gemini 的差别：
 * - ChatGPT 有独立的「聊天 / 工作」开关；本通道固定进入工作模式，
 *   再按用户方案沿用或选择工作模型；
 * - 登录走 ChatGPT 自己的页面，因此同样优先用真实 Chrome / Edge 承载，
 *   内嵌窗口只在找不到浏览器时兜底。
 */
import { BrowserWindow, shell } from 'electron'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { compileGeminiWebRequest } from '../server/gemini-web-request.mjs'
import { chatGptModelMatcher, resolveChatGptPlan } from '../server/chatgpt-plans.mjs'
import { ConversationStore, chatGptConversationUrl } from './conversation-store.mjs'
import { CdpBrowserSession, findBrowserExecutable } from './cdp-browser.mjs'

const CHATGPT_URL = 'https://chatgpt.com/'
/** ProseMirror 编辑器的 id 很稳定，其余几个选择器是给改版留的后路。 */
const EDITOR_SELECTOR =
  '#prompt-textarea, div[contenteditable="true"].ProseMirror, div.ProseMirror[contenteditable="true"], form [contenteditable="true"][role="textbox"], textarea#prompt-textarea'
const SEND_BUTTON_SELECTOR =
  'button[data-testid="send-button"], button#composer-submit-button, button[aria-label*="发送"], button[aria-label*="Send"]'
const MODEL_BUTTON_SELECTOR =
  'button[data-testid="model-switcher-dropdown-button"], button[aria-label*="选择 ChatGPT 模型"], button[aria-label*="Select ChatGPT model"], button[data-codex-intelligence-trigger="true"], button[data-testid="model-switcher"]'
const IMAGE_FILE_INPUT_SELECTOR = 'input[type="file"][accept*="image"], input[type="file"]'
/** 误判拒绝只回一句很短的能力否认；长回答里出现同类措辞不算。 */
const REFUSAL_MAX_LENGTH = 240
const REFUSAL_MARKERS = [
  '我只是一个语言模型',
  '我只是语言模型',
  '我只是一个文本',
  '我只会生成文本',
  '爱莫能助',
  '没法帮上',
  '没法帮到',
  '没法帮你',
  '无法提供这方面的帮助',
  'I am just a language model',
  "I'm just a language model",
]
/** 内嵌窗口回退时才用，版本号取当前内核自己的，避免 UA 与真实内核对不上。 */
const CHROME_USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome || '148.0.0.0'} Safari/537.36`

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export class ChatGptWebController {
  constructor({ icon, dataDir, browserProfileDir, browserExecutable }) {
    this.icon = icon
    this.window = null
    this.queue = Promise.resolve()
    // ChatGPT 与 Gemini 的对话存档分开，互不影响。
    this.conversations = new ConversationStore(dataDir, {
      file: 'chatgpt-conversations.json',
      validate: chatGptConversationUrl,
    })
    this.browserProfileDir = browserProfileDir || path.join(dataDir, 'chatgpt-browser-profile')
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
   * 优先用真实 Chrome / Edge 承载会话。ChatGPT 的登录（Google / Apple / 邮箱验证码）
   * 在内嵌窗口里同样可能踩「此浏览器或应用可能不安全」，能拿到真实浏览器就用它。
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
        startUrl: CHATGPT_URL,
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
      title: 'ChatGPT 网页对话',
      icon: this.icon,
      webPreferences: {
        partition: 'persist:promptwizard-chatgpt-web',
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    })
    win.setMenuBarVisibility(false)
    win.webContents.setUserAgent(CHROME_USER_AGENT)
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isChatGptUrl(url)) return { action: 'allow' }
      void shell.openExternal(url)
      return { action: 'deny' }
    })
    await this.#load(win)
    return win
  }

  async status() {
    const win = await this.ensureWindow(false)
    const state = await win.webContents.executeJavaScript(`(() => {
      const visible = (node) => node && node.getClientRects().length > 0;
      const label = (node) => (node.getAttribute('aria-label') || node.innerText || '').trim();
      const buttons = [...document.querySelectorAll('button,a[href]')].filter(visible);
      const login = buttons.some((node) => /^(登录|登录 ChatGPT|Log in|Sign up|注册)$/i.test(label(node)));
      const editor = [...document.querySelectorAll(${JSON.stringify(EDITOR_SELECTOR)})].find(visible);
      const modelButton = document.querySelector(${JSON.stringify(MODEL_BUTTON_SELECTOR)});
      const modelName = modelButton?.querySelector('[class*="ModelPickerTriggerModelText"]')?.textContent?.trim() || (modelButton?.innerText || '').trim().split('\\n')[0] || '';
      const effort = modelButton?.getAttribute('data-selected-reasoning-effort') || '';
      const accountNode = [...document.querySelectorAll('[data-testid="accounts-profile-button"], button[aria-label*="@"], button[aria-label*="账号"], button[aria-label*="Account"]')].find(visible);
      const body = document.body ? document.body.innerText || '' : '';
      return {
        connected: /(^|\\.)chatgpt\\.com$/.test(location.hostname) && Boolean(editor) && !login,
        account: accountNode ? label(accountNode) : '',
        model: [modelName, effort].filter(Boolean).join(' · '),
        url: location.href,
        blocked: /此浏览器或应用可能不安全|may not be secure/i.test(body),
        signin: /\\/(auth|login)/.test(location.pathname)
      };
    })()`).catch((error) => ({ connected: false, url: win.webContents.getURL(), detectionError: String(error?.message || error) }))
    const connected = Boolean(state.connected)
    return {
      connected,
      account: String(state.account || ''),
      model: String(state.model || ''),
      engine: win instanceof CdpBrowserSession ? 'chrome' : 'embedded',
      url: String(state.url || ''),
      detail: connected
        ? `ChatGPT 网页已登录${state.model ? `，当前工作模型 ${state.model}` : ''}；提交时会确认工作模式，失败时不换模型`
        : state.detectionError
          ? `无法读取 ChatGPT 网页状态：${state.detectionError}`
        : state.signin
          ? '正停留在 ChatGPT 登录页：请在窗口里完成登录'
          : this.fallbackReason
            ? `会话跑在内嵌窗口里（${this.fallbackReason}），请在其中登录 ChatGPT 账号`
            : '请在 ChatGPT 网页窗口登录账号',
    }
  }

  async openLogin() {
    const win = await this.ensureWindow(false)
    await win.show()
    let state = await this.status()
    if (state.connected) return state
    if (!isChatGptUrl(state.url || '')) {
      await this.#load(win, CHATGPT_URL)
      state = await this.status()
    }
    if (!state.connected) {
      // 登录入口就是页面上那个「登录」按钮；点不到就把窗口交给用户自己点。
      await this.#clickByLabel(win, /^(登录|Sign in|登录 ChatGPT|Log in)$/i, 8000)
      await delay(1500)
    }
    await win.show()
    return this.status()
  }

  async #clickByLabel(win, pattern, timeout) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const clicked = await win.webContents.executeJavaScript(`(() => {
        const visible = (node) => node && node.getClientRects().length > 0;
        const label = (node) => (node.getAttribute('aria-label') || node.innerText || '').trim();
        const node = [...document.querySelectorAll('button,a')].find((item) => visible(item) && ${pattern.toString()}.test(label(item)));
        if (!node) return false;
        node.click();
        return true;
      })()`).catch(() => false)
      if (clicked) return true
      await delay(500)
    }
    return false
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
    const plan = resolveChatGptPlan(body?.chatgptPlan ?? body?.geminiPlan)
    const { prompt, images } = compileGeminiWebRequest(body?.messages)
    if (!prompt.trim()) throw new Error('没有可提交给 ChatGPT 网页的提示词')

    const win = await this.ensureWindow(true)
    const previous = this.conversations.get(id)
    // 0.3.0 及更早保存的是普通聊天；没有 work 标记的一律新建工作会话。
    const saved = previous?.plan === plan.id && previous?.mode === 'work' ? previous : null
    const target = saved?.url || CHATGPT_URL
    if (!saved || chatGptConversationUrl(win.webContents.getURL()) !== saved.url) await this.#load(win, target)
    await win.show()
    await this.#waitForEditor(win)

    if (saved && chatGptConversationUrl(win.webContents.getURL()) !== saved.url) {
      throw new Error('原 ChatGPT 对话不可访问（可能被删除或切换了账号），请点击“对话跑偏，重开”')
    }

    const state = await this.status()
    if (!state.connected) throw new Error(`ChatGPT 网页暂不可提交：${state.detail}`)
    // 同一图片会话会连续执行“原图分析 → 参考图拆解”。上一轮回复出现后，
    // ChatGPT 仍可能短暂重建输入区；确认新一轮可编辑后才能上传下一批图片。
    await this.#waitForTurnReady(win)

    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'promptwizard-chatgpt-'))
    try {
      // 先检查草稿；不覆盖用户在同一窗口手动输入的内容。
      const hasDraft = await win.webContents.executeJavaScript(`(() => {
        const editor = [...document.querySelectorAll(${JSON.stringify(EDITOR_SELECTOR)})].find((node) => node.getClientRects().length > 0);
        return Boolean((editor?.value ?? editor?.innerText ?? '').trim());
      })()`)
      if (hasDraft) throw new Error('ChatGPT 输入框中有未发送内容，请先处理草稿，再重试')

      // 模型列表没加载出来的页面，composer 永远不可发送；先刷新自愈再选模式与模型。
      await this.#ensureComposerHealthy(win)

      if (!saved) await this.#selectWorkMode(win)
      await this.#selectModel(win, chatGptModelMatcher(plan), { keep: Boolean(plan.keep) })

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
      this.conversations.set(id, win.webContents.getURL(), true, {}, plan.id, 'work')
      // 上传可能重建输入区，再按同一个方案确认一次；发不出去就报错，不换方案。
      await this.#selectModel(win, chatGptModelMatcher(plan), { keep: Boolean(plan.keep) })
      if (files.length > 0) await this.#assertComposerAttachments(win, files.length)
      await this.#send(win)
      if (files.length > 0) await this.#assertSentAttachments(win)
      const content = await this.#waitForResponse(win, before)
      if (isRefusalReply(content)) throw new Error(`${plan.label} 未完成请求，未切换模型。网页回复：${content}`)
      await win.refreshUrl?.()
      const url = chatGptConversationUrl(win.webContents.getURL())
      if (!url) throw new Error('ChatGPT 未提供可恢复的对话链接，请在网页中查看结果')
      this.conversations.set(id, url, false, uploaded, plan.id, 'work')
      return content
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  async #waitForEditor(win) {
    const deadline = Date.now() + 40000
    while (Date.now() < deadline) {
      const found = await win.webContents.executeJavaScript(`Boolean([...document.querySelectorAll(${JSON.stringify(EDITOR_SELECTOR)})].find((node) => node.getClientRects().length > 0))`).catch(() => false)
      if (found) return
      await delay(500)
    }
    const state = await this.status().catch(() => null)
    if (state && !state.connected) throw new Error(`ChatGPT 网页无法提交：${state.detail}`)
    throw new Error('ChatGPT 网页加载超时，请检查网络后重试')
  }

  /** 新对话必须从首页显式选择「工作」；进入对话后开关会消失，所以复用只信任带 work 标记的存档。 */
  async #selectWorkMode(win) {
    const readMode = () => win.webContents.executeJavaScript(`(() => {
      /* prompt-wizard:work-mode-current */
      const visible = (node) => node && node.getClientRects().length > 0;
      const text = (node) => (node.innerText || '').trim();
      const chat = [...document.querySelectorAll('button')].find((node) => visible(node) && /^(聊天|Chat)$/i.test(text(node)));
      const work = [...document.querySelectorAll('button')].find((node) => visible(node) && /^(工作|Work)$/i.test(text(node)));
      const rect = work?.getBoundingClientRect();
      return {
        found: Boolean(chat && work),
        selected: work?.getAttribute('aria-pressed') === 'true',
        rect: rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null,
      };
    })()`).catch(() => ({ found: false, selected: false, rect: null }))

    let state = await readMode()
    const deadline = Date.now() + 15000
    while (!state.found && Date.now() < deadline) {
      await delay(300)
      state = await readMode()
    }
    if (!state.found || !state.rect) throw new Error('无法确认 ChatGPT 的“聊天 / 工作”开关，已停止发送')
    if (state.selected) return
    await this.#clickAt(win, state.rect)
    while (Date.now() < deadline) {
      await delay(300)
      state = await readMode()
      if (state.selected) return
    }
    throw new Error('无法确认 ChatGPT 已进入工作模式，已停止发送')
  }

  /** 「沿用网页当前模型」方案只读不点；其余方案严格切到目标工作模型，切不过去就报错。 */
  async #selectModel(win, candidate, { keep = false } = {}) {
    const readCurrent = () => win.webContents.executeJavaScript(`(() => {
      /* prompt-wizard:model-current */
      const button = document.querySelector(${JSON.stringify(MODEL_BUTTON_SELECTOR)});
      if (!button) return { found: false, current: '' };
      const label = button.querySelector('[class*="ModelPickerTriggerModelText"]')?.textContent?.trim()
        || (button.innerText || '').trim().split('\\n')[0]
        || button.getAttribute('aria-label') || '';
      return { found: true, current: label };
    })()`).catch(() => ({ found: false, current: '' }))

    let state = await readCurrent()
    const buttonDeadline = Date.now() + 15000
    while (!state.found && Date.now() < buttonDeadline) {
      await delay(300)
      state = await readCurrent()
    }
    if (keep) return state.current
    if (!state.found) throw new Error(`无法确认当前 ChatGPT 模型，已停止发送（所选 ${candidate.name}）`)
    if (matchesModel(candidate, state.current)) return state.current

    const opened = await win.webContents.executeJavaScript(`(() => {
      /* prompt-wizard:model-open */
      const button = document.querySelector(${JSON.stringify(MODEL_BUTTON_SELECTOR)});
      if (!button) return false;
      if (button.getAttribute('aria-expanded') !== 'true') button.click();
      return true;
    })()`).catch(() => false)
    if (!opened) throw new Error(`无法打开 ChatGPT 模型菜单，已停止发送（所选 ${candidate.name}）`)

    let available = false
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const selection = await win.webContents.executeJavaScript(`(() => {
        /* prompt-wizard:model-option */
        const visible = (node) => node && node.getClientRects().length > 0;
        const label = (node) => (node.innerText || node.getAttribute('aria-label') || '').trim();
        const target = ${JSON.stringify({ anyOf: candidate.anyOf, excludes: candidate.excludes })};
        const hit = (text) => {
          const value = String(text || '').toLowerCase();
          if (!value) return false;
          if (target.excludes.some((needle) => value.includes(String(needle).toLowerCase()))) return false;
          return target.anyOf.some((needle) => value.includes(String(needle).toLowerCase()));
        };
        const options = [...document.querySelectorAll('[role="menuitemradio"], [role="menuitem"], [role="option"], [role="radio"], [role="menu"] button, [role="menu"] a')]
          .filter((node) => visible(node) && hit(label(node)));
        if (!options.length) return { available: false, clicked: false };
        // 文案越短越可能是档位标题本身，避免点到描述里也提到这个词的其它选项。
        options.sort((a, b) => label(a).length - label(b).length);
        options[0].click();
        return { available: true, clicked: true, label: label(options[0]) };
      })()`).catch(() => ({ available: false, clicked: false }))
      available ||= Boolean(selection?.available)
      if (selection?.clicked) break
      await delay(250)
    }

    if (!available) {
      await this.#closeModelMenu(win)
      throw new Error(`当前 ChatGPT 账号的模型菜单里没有 ${candidate.name}，请改用「沿用网页当前模型」或确认账号权限`)
    }

    const confirmDeadline = Date.now() + 15000
    while (Date.now() < confirmDeadline) {
      await delay(300)
      state = await readCurrent()
      if (matchesModel(candidate, state.current)) return state.current
    }
    await this.#closeModelMenu(win)
    throw new Error(`ChatGPT 网页没有完成模型切换（目标 ${candidate.name}），请刷新网页后重试`)
  }

  async #closeModelMenu(win) {
    await win.webContents.executeJavaScript('document.body.click()').catch(() => {})
    await delay(300)
  }

  async #load(win, url = CHATGPT_URL) {
    try {
      await win.loadURL(url)
    } catch (error) {
      // Chromium 在登录跳转被页面接管时会报 ERR_ABORTED；只有最终仍在 ChatGPT 才能继续。
      await delay(500)
      if (!isChatGptUrl(win.webContents.getURL())) throw error
    }
  }

  async #uploadFiles(win, files) {
    const debuggerApi = win.webContents.debugger
    if (!debuggerApi.isAttached()) debuggerApi.attach('1.3')
    if (await this.#setFilesOnPageInput(debuggerApi, files)) {
      if (await this.#uploadedWithin(win, files.length, 25000)) return
    }
    await debuggerApi.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true })

    try {
      let lastError = null
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await this.#dismissOverlays(win)
        // ChatGPT 的“+”按钮点开的是「添加照片和文件」；input 可能已在 DOM 里、只是换了节点，
        // 所以每轮都重新找一次。
        const opened = await this.#clickByLabel(win, /添加照片和文件|添加文件|上传文件|Add photos|Add files|Upload/i, 4000)
        if (!opened && attempt > 0) {
          const addRect = await this.#findAttachButton(win)
          if (!addRect) throw new Error('ChatGPT 网页上找不到“添加照片和文件”按钮')
          await this.#clickAt(win, addRect)
        }

        let pushed = false
        const menuDeadline = Date.now() + 8000
        while (Date.now() < menuDeadline) {
          if (await this.#setFilesOnPageInput(debuggerApi, files)) {
            pushed = true
            break
          }
          await delay(250)
        }

        if (pushed && await this.#uploadedWithin(win, files.length, 25000)) return

        // 兜底：接住真的被打开的文件选择器。
        const chooser = this.#armFileChooser(debuggerApi, files)
        if (!pushed) await this.#clickByLabel(win, /^((添加照片和文件|添加文件|上传文件|照片和文件|Add photos.*|Upload.*))$/i, 3000)
        if (await chooser) {
          if (await this.#uploadedWithin(win, files.length, 25000)) return
        }
        if (await this.#setFilesOnPageInput(debuggerApi, files)) {
          if (await this.#uploadedWithin(win, files.length, 25000)) return
        }
        lastError = new Error(pushed
          ? '图片已提交给 ChatGPT，但附件预览没有出现，请检查网络后重试'
          : 'ChatGPT 没有接受图片上传，请重新尝试')
      }
      throw lastError ?? new Error('ChatGPT 图片上传失败，请重新尝试')
    } finally {
      await debuggerApi.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {})
    }
  }

  async #findAttachButton(win) {
    return win.webContents.executeJavaScript(`(() => {
      /* prompt-wizard:attach-button */
      const visible = (node) => node && node.getClientRects().length > 0;
      const label = (node) => (node.getAttribute('aria-label') || node.innerText || node.textContent || '').trim();
      const node = [...document.querySelectorAll('button,[role="button"]')].find((item) => visible(item)
        && /添加照片和文件|添加文件|上传文件|Add photos|Add files|Upload/i.test(label(item)));
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`).catch(() => null)
  }

  /** 关掉可能挡在“+”前面的浮层。Escape 必须走 CDP 原生命令。 */
  async #dismissOverlays(win) {
    await win.webContents.executeJavaScript(`(() => { document.body.click(); return true })()`).catch(() => {})
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
    }).catch(() => {})
    await delay(400)
  }

  /** 点“添加照片和文件”后 Chrome 会打开文件选择器；事件早于轮询返回，必须先挂监听。 */
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

  /**
   * 优先拿到 composer 里的那个 file input。ChatGPT 页面上还有别的隐藏 input，
   * 按选择器盲取可能塞给错的节点；用页面自己的 closest 判断更稳，
   * 拿不到 objectId 时再退回按选择器找。
   */
  async #setFilesOnPageInput(debuggerApi, files) {
    try {
      const found = await debuggerApi.sendCommand('Runtime.evaluate', {
        expression: `(() => {
          const inputs = [...document.querySelectorAll('input[type="file"]')];
          const scoped = inputs.filter((node) => node.closest('form, [data-testid="composer"], [data-testid*="composer"]'));
          return scoped[scoped.length - 1] || inputs[inputs.length - 1] || null;
        })()`,
        returnByValue: false,
      })
      const objectId = found?.result?.objectId
      if (objectId) {
        await debuggerApi.sendCommand('DOM.setFileInputFiles', { files, objectId })
        await debuggerApi.sendCommand('Runtime.releaseObject', { objectId }).catch(() => {})
        return true
      }
    } catch {
      // 个别工具链不允许 Runtime.evaluate，退回按选择器找。
    }
    try {
      await debuggerApi.sendCommand('DOM.enable')
      const { root } = await debuggerApi.sendCommand('DOM.getDocument', { depth: -1, pierce: true })
      for (const selector of IMAGE_FILE_INPUT_SELECTOR.split(', ')) {
        const { nodeIds = [] } = await debuggerApi.sendCommand('DOM.querySelectorAll', {
          nodeId: root.nodeId,
          selector,
        })
        if (nodeIds.length === 0) continue
        await debuggerApi.sendCommand('DOM.setFileInputFiles', { files, nodeId: nodeIds[nodeIds.length - 1] })
        return true
      }
      return false
    } catch {
      return false
    }
  }

  async #uploadedWithin(win, expected, timeout) {
    try {
      await this.#waitForUploadedFiles(win, expected, timeout)
      return true
    } catch {
      return false
    }
  }

  /**
   * 附件预览：只看 composer 自己的范围。以前把 main img 也算进来，
   * 会话里已有的图会让计数在附件真正传完之前就够数，导致消息发出去却不带图。
   */
  async #composerAttachments(win) {
    const raw = await win.webContents.executeJavaScript(`(() => {
      /* prompt-wizard:composer-attachments */
      const visible = (node) => node && node.getClientRects().length > 0;
      const composer = document.querySelector('form, [data-testid="composer"], [class*="ComposerLayoutRoot"]');
      if (!composer) return null;
      const chips = [...composer.querySelectorAll(
        '[class*="composer-attachment"], [data-testid*="attachment"], [data-testid*="file-thumbnail"], [aria-label$=".png"], [aria-label$=".jpg"], [aria-label$=".jpeg"], [aria-label$=".webp"]'
      )].filter(visible);
      const imgs = [...composer.querySelectorAll('img')].filter(visible).filter((node) => {
        const src = node.getAttribute('src') || '';
        const alt = node.getAttribute('alt') || '';
        if (/oaiusercontent/.test(src)) return false;
        return /^(blob:|data:image)/i.test(src) || /\\.(png|jpe?g|webp|gif|heic)$/i.test(alt);
      });
      const uploading = [...composer.querySelectorAll('[role="progressbar"], [class*="uploading" i], [data-testid*="upload" i]')]
        .filter(visible).length;
      return { count: Math.max(chips.length, imgs.length), uploading };
    })()`).catch(() => null)
    return raw && typeof raw === 'object' ? raw : { count: 0, uploading: 0 }
  }

  async #waitForUploadedFiles(win, expected, timeout = 45000) {
    const deadline = Date.now() + timeout
    let stable = 0
    while (Date.now() < deadline) {
      const state = await this.#composerAttachments(win)
      const ready = state.count >= expected && state.uploading === 0
      stable = ready ? stable + 1 : 0
      // 连续两拍都够数且没有进度条，才算真的传完。
      if (stable >= 2) return
      await delay(400)
    }
    throw new Error(`图片已交给 ChatGPT 网页，但附件预览未在 ${Math.round(timeout / 1000)} 秒内稳定出现，请检查网络后重试`)
  }

  async #fillPrompt(win, prompt) {
    const focused = await win.webContents.executeJavaScript(`(() => {
      const visible = (node) => node && node.getClientRects().length > 0;
      const editor = [...document.querySelectorAll(${JSON.stringify(EDITOR_SELECTOR)})].find(visible);
      if (!editor) return false;
      editor.focus();
      return true;
    })()`)
    if (!focused) throw new Error('无法写入 ChatGPT 提示词输入框')
    await win.webContents.insertText(prompt)
    await delay(300)
  }

  async #waitForTurnReady(win, timeout = 45000) {
    const deadline = Date.now() + timeout
    let stable = 0
    while (Date.now() < deadline) {
      const ready = await win.webContents.executeJavaScript(`(() => {
        /* prompt-wizard:turn-ready */
        const visible = (node) => node && node.getClientRects().length > 0;
        const label = (node) => (node.getAttribute('aria-label') || node.innerText || '').trim();
        const editor = [...document.querySelectorAll(${JSON.stringify(EDITOR_SELECTOR)})].find(visible);
        const generating = [...document.querySelectorAll('button')]
          .some((node) => visible(node) && ${STOP_BUTTON_PATTERN_SOURCE}.test(label(node)));
        return Boolean(editor && !generating && !editor.disabled
          && editor.getAttribute('aria-disabled') !== 'true'
          && editor.getAttribute('contenteditable') !== 'false');
      })()`).catch(() => false)
      stable = ready ? stable + 1 : 0
      if (stable >= 2) return
      await delay(500)
    }
    throw new Error('ChatGPT 上一轮仍未完全结束，尚不能上传下一批参考图，请稍后重试')
  }

  /**
   * composer 健康度。ChatGPT 偶尔会停在「无法加载 ChatGPT 模型」的状态：
   * 模型按钮变成禁用，连带发送按钮永久不可用，此时页面自己能恢复，应用只能靠刷新。
   */
  async #composerHealth(win) {
    const raw = await win.webContents.executeJavaScript(`(() => {
      /* prompt-wizard:composer-health */
      const visible = (node) => node && node.getClientRects().length > 0;
      const label = (node) => (node.getAttribute('aria-label') || node.innerText || '').trim();
      const model = [...document.querySelectorAll('button')].find((node) => visible(node)
        && /选择 ChatGPT 模型|Select ChatGPT model/i.test(label(node)));
      const send = [...document.querySelectorAll('button')].find((node) => visible(node)
        && /^(发送|Send)$/i.test(label(node).trim()));
      const modelText = model ? (model.innerText || '').trim() : '';
      return {
        modelFound: Boolean(model),
        modelBroken: Boolean(model) && (/无法加载|加载失败|Failed to load|Couldn't load/i.test(modelText)
          || model.getAttribute('aria-disabled') === 'true'),
        sendFound: Boolean(send),
        sendDisabled: send ? (send.disabled || send.getAttribute('aria-disabled') === 'true') : null,
      };
    })()`).catch(() => null)
    // 页面还没渲染好（或测试替身没有这套 DOM）时返回 unknown，不要误判成“坏掉”。
    return raw && typeof raw === 'object'
      ? raw
      : { modelFound: false, modelBroken: false, sendFound: false, sendDisabled: null }
  }

  async #reloadPage(win) {
    await win.webContents.debugger.sendCommand('Page.reload', { ignoreCache: true }).catch(() => {})
    await delay(1500)
    await this.#waitForEditor(win)
    await this.#waitForTurnReady(win)
  }

  /** 模型列表没加载出来就先自愈：刷新页面重试，刷新两次仍不行才报错说明原因。 */
  async #ensureComposerHealthy(win) {
    let health = await this.#composerHealth(win)
    for (let attempt = 0; attempt < 2 && health.modelBroken; attempt += 1) {
      await this.#reloadPage(win)
      health = await this.#composerHealth(win)
    }
    if (health.modelBroken) {
      throw new Error('ChatGPT 页面的模型列表没有加载出来（常见于网络中断或登录过期），已自动刷新两次仍失败；请在网页窗口里刷新或重新登录后重试')
    }
    return health
  }

  /** 发送前最后确认一次：附件必须还在 composer 里，数量不能少。 */
  async #assertComposerAttachments(win, expected) {
    const deadline = Date.now() + 8000
    let state = await this.#composerAttachments(win)
    while (Date.now() < deadline && state.count < expected) {
      await delay(400)
      state = await this.#composerAttachments(win)
    }
    if (state.count < expected) {
      throw new Error(`发送前发现图片附件只剩 ${state.count}/${expected} 张（上传可能被打断），已停止发送；请点「重跑」重新提交`)
    }
  }

  /** 发送后确认用户消息真的带上了图片，否则模型只能看到文字，结果会不可用。 */
  async #assertSentAttachments(win) {
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const count = await win.webContents.executeJavaScript(`(() => {
        /* prompt-wizard:sent-attachments */
        // 新版 DOM 把用户附件渲染在会话主区、而不是用户气泡内部，
        // 所以只能按整个会话区统计；会话节点也可能不再带 role 属性。
        const main = document.querySelector('main') || document.body;
        const marked = main.querySelectorAll('img[alt*="附件"], img[alt*="attachment" i]').length;
        const blobs = main.querySelectorAll('img[src^="blob:"]').length;
        return Math.max(marked, blobs);
      })()`).catch(() => 0)
      if (count > 0) return
      await delay(500)
    }
    throw new Error('消息已经发出，但这一轮没有带上图片附件（ChatGPT 上传未完成），模型只看得到文字；请点「重跑」重新提交')
  }

  async #send(win) {
    const deadline = Date.now() + 30000
    // 输入完成后发送按钮通常马上解禁；页面异常时它会一直禁用，这里先等它可用，
    // 免得对着一个永远点不动的按钮空转到超时，最后报一句看不出原因的话。
    let health = await this.#composerHealth(win)
    if (health.modelBroken) {
      throw new Error('ChatGPT 页面的模型列表没有加载出来（常见于网络中断或登录过期），发送按钮一直不可用；请点「重跑」，或到网页窗口刷新后重试')
    }
    if (health.sendFound) {
      const enableBy = Date.now() + 12000
      while (Date.now() < enableBy && health.sendDisabled !== false) {
        await delay(300)
        health = await this.#composerHealth(win)
        if (health.modelBroken) {
          throw new Error('ChatGPT 页面的模型列表没有加载出来（常见于网络中断或登录过期），发送按钮一直不可用；请点「重跑」，或到网页窗口刷新后重试')
        }
      }
    }
    while (Date.now() < deadline) {
      const state = await win.webContents.executeJavaScript(`(() => {
        /* prompt-wizard:guarded-send */
        const visible = (node) => node && node.getClientRects().length > 0;
        const editor = [...document.querySelectorAll(${JSON.stringify(EDITOR_SELECTOR)})].find(visible);
        if (!editor) return { clicked: false };
        editor.focus();
        const send = [...document.querySelectorAll(${JSON.stringify(SEND_BUTTON_SELECTOR)})]
          .find((node) => visible(node) && !node.disabled);
        if (!send) return { clicked: false };
        const userCount = document.querySelectorAll('[data-message-author-role="user"], [data-content-search-unit-key$=":user"], [data-chatgpt-search-unit-key$=":user"]').length;
        send.click();
        return { clicked: true, userCount };
      })()`).catch(() => ({ clicked: false }))
      if (state?.clicked) {
        while (Date.now() < deadline) {
          const accepted = await win.webContents.executeJavaScript(`(() => {
            /* prompt-wizard:send-confirmation */
            const visible = (node) => node && node.getClientRects().length > 0;
            const label = (node) => (node.getAttribute('aria-label') || node.innerText || '').trim();
            const editor = [...document.querySelectorAll(${JSON.stringify(EDITOR_SELECTOR)})].find(visible);
            const cleared = Boolean(editor && ((editor.value ?? editor.innerText ?? '').trim() === ''));
            const generating = [...document.querySelectorAll('button')]
              .some((node) => visible(node) && ${STOP_BUTTON_PATTERN_SOURCE}.test(label(node)));
            const userCount = document.querySelectorAll('[data-message-author-role="user"], [data-content-search-unit-key$=":user"], [data-chatgpt-search-unit-key$=":user"]').length;
            return cleared || generating || userCount > ${Number(state.userCount || 0)};
          })()`).catch(() => false)
          if (accepted) return
          await delay(500)
        }
        break
      }
      await delay(500)
    }
    throw new Error(health.sendFound && health.sendDisabled
      ? 'ChatGPT 的发送按钮一直不可用（模型列表或附件没加载完），请点「重跑」，或在网页窗口刷新后重试'
      : 'ChatGPT 未能确认发送，请检查网页输入区或附件是否仍在处理中')
  }

  async #clickAt(win, rect) {
    const x = Math.max(0, Math.round(rect.x))
    const y = Math.max(0, Math.round(rect.y))
    win.webContents.sendInputEvent({ type: 'mouseMove', x, y })
    win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
    await delay(200)
  }

  /** 只读最后一条助手消息；思考过程和引用角标都要排除在正文之外。 */
  async #latestResponse(win) {
    return win.webContents.executeJavaScript(`(() => {
      /* prompt-wizard:latest-response */
      const inThread = (node) => !node.closest('aside, nav') && !/[Ss]idebar/.test(String(node.className));
      let nodes = [...document.querySelectorAll(
        '[data-message-author-role="assistant"], [data-content-search-unit-key$=":assistant"], [data-chatgpt-search-unit-key$=":assistant"]'
      )].filter((node, index, all) => !all.some((other, otherIndex) => otherIndex !== index && other.contains(node)));
      // 新版 ChatGPT 的会话 DOM 已经不再带 data-message-author-role，
      // 助手回答只剩 MarkdownRoot 容器；按出现顺序取最后一个，别整条链路失效。
      if (nodes.length === 0) {
        const thread = document.querySelector('main') || document.body;
        nodes = [...thread.querySelectorAll('[class*="MarkdownRoot"]')].filter(inThread);
      }
      const last = nodes[nodes.length - 1];
      if (last && !last.dataset.promptWizardTurn) last.dataset.promptWizardTurn = crypto.randomUUID();
      if (!last) return { count: 0, id: '', text: '', work: false };
      const output = last.matches('[class*="MarkdownRoot"]') ? last
        : (last.querySelector('[data-markdown-text-style="assistant-message"], .markdown, [class*="MarkdownRoot"], [class*="markdown"], [class*="prose"]') || last);
      const hidden = [...output.querySelectorAll('[class*="reasoning"], [data-testid*="reasoning"], [data-testid*="citation"], [class*="citation"], sup')];
      const previous = hidden.map((node) => node.style.display);
      hidden.forEach((node) => { node.style.display = 'none'; });
      const text = (output.innerText || '').trim();
      hidden.forEach((node, index) => { node.style.display = previous[index]; });
      const messageId = last.getAttribute('data-chatgpt-search-message-ids')
        || last.querySelector('[data-chatgpt-selection-message-id]')?.getAttribute('data-chatgpt-selection-message-id')
        || last.dataset.promptWizardTurn;
      return { count: nodes.length, id: messageId, text, work: last.hasAttribute('data-content-search-unit-key') || last.hasAttribute('data-chatgpt-search-unit-key') };
    })()`).catch(() => ({ count: 0, id: '', text: '', work: false }))
  }

  async #waitForResponse(win, before) {
    const deadline = Date.now() + 300000
    let last = ''
    let stable = 0
    let imageTurns = 0
    while (Date.now() < deadline) {
      const current = await this.#latestResponse(win)
      const state = await this.#generationState(win)
      // 被误解成「帮我画图」时 ChatGPT 会去生成图片：正文一直是空的，早点停下来说明原因。
      if (state.image && (!current.text || isPendingReply(current.text))) {
        imageTurns += 1
        if (imageTurns >= 6) {
          await this.#stopGenerating(win)
          throw new Error('ChatGPT 把这次请求误判成「生成图片」，已停止这次生成；请点「重跑」再试')
        }
      } else {
        imageTurns = 0
      }
      if (current.text && (current.count > before.count || current.id !== before.id)) {
        // 先渲染的「正在思考…」这类状态同样会稳定两秒，不能当成最终回复。
        if (isPendingReply(current.text)) {
          stable = 0
          last = ''
          await delay(1000)
          continue
        }
        stable = current.text === last ? stable + 1 : 0
        last = current.text
        // 「工作」模式的完成标记偶尔根本不出现，别把等待卡死在这里：
        // 有完成标记就立刻收；没有就看停止按钮是否消失 + 正文是否稳定（多稳一拍防抖）。
        if (state.complete && stable >= 1) return current.text
        if (!state.generating && stable >= (current.work ? 3 : 2)) return current.text
      }
      await delay(1000)
    }
    throw new Error(last ? 'ChatGPT 回复生成超时，可在网页窗口查看未完成内容' : '没有抓取到 ChatGPT 网页回复')
  }

  async #generationState(win) {
    return win.webContents.executeJavaScript(`(() => {
      /* prompt-wizard:generation-state */
      const visible = (node) => node && node.getClientRects().length > 0;
      const label = (node) => (node.getAttribute('aria-label') || node.innerText || '').trim();
      const stop = [...document.querySelectorAll('button')]
        .some((node) => visible(node) && ${STOP_BUTTON_PATTERN_SOURCE}.test(label(node)));
      const status = [...document.querySelectorAll('[role="status"]')]
        .map((node) => (node.innerText || node.textContent || '').trim()).join('\\n');
      const complete = /回答已完成|任务已完成|Answer complete|Task complete/i.test(status);
      if (!stop) return { generating: false, image: false, complete };
      const scope = document.body ? document.body.innerText || '' : '';
      return { generating: true, image: ${IMAGE_CREATION_PATTERN_SOURCE}.test(scope), complete: false };
    })()`).catch(() => ({ generating: false, image: false, complete: false }))
  }

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
const STOP_BUTTON_PATTERN_SOURCE = String.raw`/^(停止|停止回答|停止生成|停止生成回复|停止流式传输|停止任务|Stop|Stop response|Stop generating|Stop streaming|Stop task)(\s|$)/i`
/** 生成图片的进度文案是临时的，生成完就消失，不会把历史里的图片误判成正在生成。 */
const IMAGE_CREATION_PATTERN_SOURCE = String.raw`/正在创建您的图片|正在创建图片|正在生成图片|正在制作图片|Creating your image|Generating your image|Creating image/i`

/** 菜单文案里带副标题，用候选自己的 anyOf/excludes 子串判断，避免写死版本号。 */
function matchesModel(candidate, text) {
  const value = String(text || '').toLowerCase()
  if (!value) return false
  if (candidate.excludes.some((needle) => value.includes(String(needle).toLowerCase()))) return false
  return candidate.anyOf.some((needle) => value.includes(String(needle).toLowerCase()))
}

/** ChatGPT 也会先渲染「正在思考…」这类占位，不能当成最终回复。 */
const PENDING_MARKERS = /正在思考|正在生成|思考中|正在深入思考|Thinking|正在回答|生成回答中|正在处理/g
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

function isChatGptUrl(value) {
  try {
    const host = new URL(value).hostname
    return host === 'chatgpt.com' || host.endsWith('.chatgpt.com') || host.endsWith('.openai.com')
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
