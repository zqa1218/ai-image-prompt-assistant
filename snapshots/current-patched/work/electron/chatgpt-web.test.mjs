import { afterEach, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const fake = vi.hoisted(() => ({
  scriptErrors: [],
  sends: 0,
  modelSelections: 0,
  fileSelectors: [],
  loads: [],
  inputEvents: [],
  modelOptionAvailable: true,
  editorPresent: true,
  draft: false,
  editorCleared: true,
  turnReadyQueue: [],
  uploadCount: 0,
  connected: true,
  workSelected: false,
  responseQueue: [],
  generationState: { generating: false, image: false, complete: true },
}))

// 单元测试里不启动真实浏览器，统一走内嵌窗口分支。
vi.mock('./cdp-browser.mjs', () => ({
  CdpBrowserSession: class {},
  findBrowserExecutable: () => '',
}))
vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
  BrowserWindow: class {
    constructor() {
      this.url = 'https://chatgpt.com/'
      this.model = 'GPT-6.1 Sol'
      this.webContents = {
        setUserAgent() {},
        setWindowOpenHandler() {},
        getURL: () => this.url,
        insertText: async () => {},
        debugger: {
          isAttached: () => true,
          attach() {},
          on() {},
          removeListener() {},
          sendCommand: async (method, params = {}) => {
            if (method === 'DOM.getDocument') return { root: { nodeId: 1 } }
            if (method === 'Runtime.evaluate') return { result: { type: 'object' } }
            if (method === 'DOM.querySelectorAll') {
              fake.fileSelectors.push(params.selector)
              return params.selector === 'input[type="file"]' ? { nodeIds: [2] } : { nodeIds: [] }
            }
            if (method === 'DOM.setFileInputFiles') fake.uploadCount = params.files.length
            return {}
          },
        },
        sendInputEvent: (event) => {
          fake.inputEvents.push(event)
          if (event.type === 'mouseUp') fake.workSelected = true
        },
        executeJavaScript: async (script) => {
          try { new Function(script) } catch (error) {
            fake.scriptErrors.push(error.message)
            throw error
          }
          if (script.includes('accounts-profile-button')) {
            return fake.connected
              ? { connected: true, account: 'user@example.com', model: this.model, url: this.url }
              : { connected: false, url: 'https://chatgpt.com/auth/login', signin: true }
          }
          if (script.includes('editor?.value ?? editor?.innerText')) return fake.draft
          if (script.startsWith('Boolean(')) return fake.editorPresent
          if (script.includes('prompt-wizard:work-mode-current')) {
            return { found: true, selected: fake.workSelected, rect: { x: 10, y: 10 } }
          }
          if (script.includes('prompt-wizard:model-current')) return { found: true, current: this.model }
          if (script.includes('prompt-wizard:model-open')) return true
          if (script.includes('prompt-wizard:model-option')) {
            fake.modelSelections += 1
            if (!fake.modelOptionAvailable) return { available: false, clicked: false }
            const wanted = /gpt-6\.1 sol/i.test(script) ? 'GPT-6.1 Sol'
              : /gpt-6 astra/i.test(script) ? 'GPT-6 Astra'
                : /gpt-6 luna/i.test(script) ? 'GPT-6 Luna'
                  : 'GPT-6 Sol'
            this.model = wanted
            return { available: true, clicked: true, label: wanted }
          }
          if (script.includes('prompt-wizard:uploaded-files')) return fake.uploadCount
          if (script.includes('prompt-wizard:composer-attachments')) {
            return { count: fake.uploadCount, uploading: 0 }
          }
          if (script.includes('prompt-wizard:sent-attachments')) return fake.uploadCount
          if (script.includes('prompt-wizard:composer-health')) {
            return { modelFound: true, modelBroken: false, sendFound: true, sendDisabled: false }
          }
          if (script.includes('prompt-wizard:attach-button')) return { x: 10, y: 10 }
          if (script.includes('prompt-wizard:turn-ready')) {
            return fake.turnReadyQueue.length > 0 ? fake.turnReadyQueue.shift() : true
          }
          if (script.includes('prompt-wizard:guarded-send')) {
            if (!fake.editorCleared) return { clicked: true }
            fake.sends += 1
            if (!/\/c\//.test(this.url)) this.url = `https://chatgpt.com/c/test-${fake.sends}`
            return { clicked: true, userCount: Math.max(0, fake.sends - 1) }
          }
          if (script.includes('prompt-wizard:send-confirmation')) return fake.editorCleared
          if (script.includes("=== ''")) return fake.editorCleared
          if (script.includes('editor.focus()')) return fake.editorPresent
          if (script.includes('prompt-wizard:latest-response')) {
            if (!fake.sends) return { count: 0, id: '', text: '' }
            const next = fake.responseQueue.length > 1
              ? fake.responseQueue.shift()
              : fake.responseQueue[0] ?? { id: 'turn-1', text: '相同回复' }
            return { count: fake.sends, id: `turn-${next.id}`, text: next.text, work: true }
          }
          if (script.includes('prompt-wizard:generation-state')) return fake.generationState
          if (script.includes('prompt-wizard:stop-generating')) return true
          return null
        },
      }
    }
    async loadURL(url) { fake.loads.push(url); this.url = url }
    async show() {}
    setMenuBarVisibility() {}
    on() {}
    isDestroyed() { return false }
  },
}))

const { ChatGptWebController } = await import('./chatgpt-web.mjs')

afterEach(() => { expect(fake.scriptErrors.splice(0)).toEqual([]) })

const body = (id, chatgptPlan = 'current') => ({
  conversationId: id,
  chatgptPlan,
  messages: [{ role: 'user', content: [{ type: 'text', text: '测试' }] }],
})

it('默认方案先进入工作模式、沿用当前模型，并按底图复用同一个工作对话', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pw-chatgpt-keep-test-'))
  try {
    const controller = new ChatGptWebController({ dataDir: dir })
    expect(await controller.submit(body('image-chatgpt'))).toBe('相同回复')
    expect(fake.workSelected).toBe(true)
    // 默认方案不碰模型菜单：菜单改版也不会把这条通道弄坏。
    expect(fake.modelSelections).toBe(0)
    expect(controller.window.url).toMatch(/^https:\/\/chatgpt\.com\/c\//)
    const loads = fake.loads.length
    expect(await controller.submit(body('image-chatgpt'))).toBe('相同回复')
    expect(fake.loads.length).toBe(loads)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}, 30000)

it('工作模式里严格选择目标模型；未知方案与菜单里没有该模型都直接报错', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pw-chatgpt-plan-test-'))
  try {
    const controller = new ChatGptWebController({ dataDir: dir })
    expect(await controller.submit(body('image-sol', 'gpt-6.1-sol'))).toBe('相同回复')
    expect(controller.window.model).toBe('GPT-6.1 Sol')
    await expect(controller.submit(body('image-unknown', 'unknown-plan'))).rejects.toThrow('未知的 ChatGPT 网页方案')
    fake.modelOptionAvailable = false
    await expect(controller.submit(body('image-astra', 'gpt-6-astra'))).rejects.toThrow('模型菜单里没有')
  } finally {
    fake.modelOptionAvailable = true
    rmSync(dir, { recursive: true, force: true })
  }
}, 40000)

it('带图提交时把底图与参考图交给网页文件输入框，并确认附件预览', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pw-chatgpt-upload-test-'))
  try {
    fake.fileSelectors = []
    const controller = new ChatGptWebController({ dataDir: dir })
    const payload = {
      conversationId: 'image-upload',
      chatgptPlan: 'current',
      messages: [{ role: 'user', content: [
        { type: 'text', text: '测试' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
      ] }],
    }
    expect(await controller.submit(payload)).toBe('相同回复')
    expect(fake.fileSelectors).toContain('input[type="file"]')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}, 30000)

it('连续两轮图片请求会等待上一轮输入区稳定后再上传参考图', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pw-chatgpt-turn-ready-test-'))
  try {
    const controller = new ChatGptWebController({ dataDir: dir })
    const withImage = (text) => ({
      conversationId: 'image-sequential',
      chatgptPlan: 'current',
      messages: [{ role: 'user', content: [
        { type: 'text', text },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${Buffer.from(text).toString('base64')}` } },
      ] }],
    })
    await controller.submit(withImage('原图分析'))
    fake.turnReadyQueue = [false, false, true, true]
    await expect(controller.submit(withImage('参考图拆解'))).resolves.toBe('相同回复')
    expect(fake.turnReadyQueue).toEqual([])
  } finally {
    fake.turnReadyQueue = []
    rmSync(dir, { recursive: true, force: true })
  }
}, 30000)

it('未登录时不提交；短拒答按失败报告，不切换模型', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pw-chatgpt-refusal-test-'))
  try {
    const controller = new ChatGptWebController({ dataDir: dir })
    fake.connected = false
    await expect(controller.submit(body('image-login'))).rejects.toThrow('ChatGPT 网页暂不可提交')
    fake.connected = true
    const picks = fake.modelSelections
    fake.responseQueue = [{ id: 'refusal', text: '我只是一个语言模型' }]
    await expect(controller.submit(body('image-refusal'))).rejects.toThrow('未切换模型。网页回复：我只是一个语言模型')
    expect(fake.modelSelections).toBe(picks)
  } finally {
    fake.connected = true
    fake.responseQueue = []
    rmSync(dir, { recursive: true, force: true })
  }
}, 40000)
