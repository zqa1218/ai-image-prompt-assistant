/**
 * ChatGPT 网页通道：把「Skill + 需求 + 底图 + 参考图」提交到 chatgpt.com，
 * 抓回纯文字提示词。对外接口与 GeminiWebController 保持一致，
 * 这样 server/index.mjs 只按设置里的 mode 分派，前端不用区分渠道。
 *
 * 与 Gemini 的差别：
 * - 没有「对话 / 任务」开关，只有模型档位（Instant / Thinking / Pro / 自动）；
 *   默认方案是「沿用网页当前模型」，不切换就不会因为菜单改版而失败；
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
  'button[data-testid="model-switcher-dropdown-button"], button[aria-label*="模型选择器"], button[aria-label*="Model selector"], button[data-testid="model-switcher"], button[aria-haspopup="menu"]'
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
      const accountNode = [...document.querySelectorAll('[data-testid="accounts-profile-button"], button[aria-label*="@"], button[aria-label*="账号"], button[aria-label*="Account"]')].find(visible);
      const body = document.body ? document.body.innerText || '' : '';
      return {
        connected: /(^|\\.)chatgpt\\.com$/.test(location.hostname) && Boolean(editor) && !login,
        account: accountNode ? label(accountNode) : '',
        model: modelButton ? label(modelButton) : '',
        url: location.href,
        blocked: /此浏览器或应用可能不安全|may not be secure/i.test(body),
        signin: /\\/(auth|login)/.test(location.pathname)
      };
    })()`).catch(() => ({ connected: false, url: '' }))
    const connected = Boolean(state.connected)
    return {
      connected,
      account: String(state.account || ''),
      model: String(state.model || ''),
      engine: win instanceof CdpBrowserSession ? 'chrome' : 'embedded',
      url: String(state.url || ''),
      detail: connected
        ? `ChatGPT 网页已登录${state.model ? `，当前模型 ${state.model}` : ''}；按所选方案提交，失败时不换模型`
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
    const saved = previous?.plan === plan.id ? previous : null
    const target = saved?.url || CHATGPT_URL
    if (!saved || chatGptConversationUrl(win.webContents.getURL()) !== saved.url) await this.#load(win, target)
    await win.show()
    await this.#waitForEditor(win)

    if (saved && chatGptConversationUrl(win.webContents.getURL()) !== saved.url) {
      throw new Error('原 ChatGPT 对话不可访问（可能被删除或切换了账号），请点击“对话跑偏，重开”')
    }

    const state = await this.status()
    if (!state.connected) throw new Error(`ChatGPT 网页尚未登录：${state.detail}`)

    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'promptwizard-chatgpt-'))
    try {
      // 先检查草稿；不覆盖用户在同一窗口手动输入的内容。
      const hasDraft = await win.webContents.executeJavaScript(`(() => {
        const editor = [...document.querySelectorAll(${JSON.stringify(EDITOR_SELECTOR)})].find((node) => node.getClientRects().length > 0);
        return Boolean((editor?.value ?? editor?.innerText ?? '').trim());
      })()`)
      if (hasDraft) throw new Error('ChatGPT 输入框中有未发送内容，请先处理草稿，再重试')

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
      this.conversations.set(id, win.webContents.getURL(), true, {}, plan.id)
      // 上传可能重建输入区，再按同一个方案确认一次；发不出去就报错，不换方案。
      await this.#selectModel(win, chatGptModelMatcher(plan), { keep: Boolean(plan.keep) })
      await this.#send(win)
      const content = await this.#waitForResponse(win, before)
      if (isRefusalReply(content)) throw new Error(`${plan.label} 未完成请求，未切换模型。网页回复：${content}`)
      await win.refreshUrl?.()
      const url = chatGptConversationUrl(win.webContents.getURL())
      if (!url) throw new Error('ChatGPT 未提供可恢复的对话链接，请在网页中查看结果')
      this.conversations.set(id, url, false, uploaded, plan.id)
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

  /** 「沿用网页当前模型」方案只读不点；其余方案严格切到目标档位，切不过去就报错。 */
  async #selectModel(win, candidate, { keep = false } = {}) {
    const readCurrent = () => win.webContents.executeJavaScript(`(() => {
      /* prompt-wizard:model-current */
      const button = document.querySelector(${JSON.stringify(MODEL_BUTTON_SELECTOR)});
      if (!button) return { found: false, current: '' };
      return { found: true, current: (button.innerText || button.getAttribute('aria-label') || '').trim() };
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

  async #setFilesOnPageInput(debuggerApi, files) {
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
   * 附件预览：ChatGPT 用 blob:/data: 缩略图或带文件名的 alt 展示，
   * 这里同时数缩略图和附件卡片，取较大值；AI 生成的图片走 oaiusercontent，排除掉。
   */
  async #waitForUploadedFiles(win, expected, timeout = 30000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const count = await win.webContents.executeJavaScript(`(() => {
        /* prompt-wizard:uploaded-files */
        const visible = (node) => node && node.getClientRects().length > 0;
        const imgs = [...document.querySelectorAll('form img, [data-testid="composer"] img, [data-testid*="attachment"] img, main img')]
          .filter(visible)
          .filter((node) => {
            const src = node.getAttribute('src') || '';
            const alt = node.getAttribute('alt') || '';
            if (/oaiusercontent/.test(src)) return false;
            if (/^(blob:|data:image)/i.test(src)) return true;
            return /\\.(png|jpe?g|webp|gif|heic)$/i.test(alt);
          });
        const cards = [...document.querySelectorAll('[data-testid="composer-attachment"], [data-testid*="attachment-preview"], [data-testid*="file-thumbnail"]')].filter(visible);
        return Math.max(imgs.length, cards.length);
      })()`).catch(() => 0)
      if (count >= expected) return
      await delay(300)
    }
    throw new Error(`图片已交给 ChatGPT 网页，但附件预览未在 ${Math.round(timeout / 1000)} 秒内出现，请检查网络后重试`)
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

  async #send(win) {
    const deadline = Date.now() + 30000
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
        send.click();
        return { clicked: true };
      })()`).catch(() => ({ clicked: false }))
      if (state?.clicked) {
        await delay(600)
        const cleared = await win.webContents.executeJavaScript(`(() => {
          const visible = (node) => node && node.getClientRects().length > 0;
          const editor = [...document.querySelectorAll(${JSON.stringify(EDITOR_SELECTOR)})].find(visible);
          return Boolean(editor && ((editor.value ?? editor.innerText ?? '').trim() === ''));
        })()`).catch(() => false)
        if (cleared) return
      }
      await delay(500)
    }
    throw new Error('ChatGPT 未能确认发送（输入框未清空），请检查网页是否仍可操作')
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
      const nodes = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
      const last = nodes[nodes.length - 1];
      if (last && !last.dataset.promptWizardTurn) last.dataset.promptWizardTurn = crypto.randomUUID();
      if (!last) return { count: 0, id: '', text: '' };
      const output = last.querySelector('.markdown, [class*="markdown"], [class*="prose"]') || last;
      const hidden = [...output.querySelectorAll('[class*="reasoning"], [data-testid*="reasoning"], [data-testid*="citation"], [class*="citation"], sup')];
      const previous = hidden.map((node) => node.style.display);
      hidden.forEach((node) => { node.style.display = 'none'; });
      const text = (output.innerText || '').trim();
      hidden.forEach((node, index) => { node.style.display = previous[index]; });
      return { count: nodes.length, id: last.dataset.promptWizardTurn, text };
    })()`).catch(() => ({ count: 0, id: '', text: '' }))
  }

  async #waitForResponse(win, before) {
    const deadline = Date.now() + 180000
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
        if (!state.generating && stable >= 2) return current.text
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
      if (!stop) return { generating: false, image: false };
      const scope = document.body ? document.body.innerText || '' : '';
      return { generating: true, image: ${IMAGE_CREATION_PATTERN_SOURCE}.test(scope) };
    })()`).catch(() => ({ generating: false, image: false }))
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
const STOP_BUTTON_PATTERN_SOURCE = String.raw`/^(停止|停止回答|停止生成|停止生成回复|停止流式传输|Stop|Stop response|Stop generating|Stop streaming)(\s|$)/i`
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
