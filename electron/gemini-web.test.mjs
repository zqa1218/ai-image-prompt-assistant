import { it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const fake = vi.hoisted(() => ({ windows: [], chats: new Map(), next: 0, modelSelections: 0, fileSelectors: [], refusalTurns: new Set(), modeState: 'selected', guardedMode: 'selected', guardedModes: [], guardedModel: '', modelFound: true, modelMissingReads: 0, modes: [], inputEvents: [], responseQueue: [], generationState: { generating: false, image: false }, stops: 0, scriptMenuOpens: true, addButton: { x: 10, y: 10 }, uploadMenuItem: null, mouseIgnored: false, responseScripts: [] }))
// 单元测试里不启动真实浏览器，统一走内嵌窗口分支。
vi.mock('./cdp-browser.mjs', () => ({
  CdpBrowserSession: class {},
  findBrowserExecutable: () => '',
}))
vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
  BrowserWindow: class {
    constructor() {
      this.url = ''
      this.loads = []
      this.model = 'Argon'
      this.menuOpen = false
      this.webContents = {
        setUserAgent() {}, setWindowOpenHandler() {},
        getURL: () => this.url,
        insertText: async () => {},
        debugger: {
          isAttached: () => true,
          attach() {}, on() {}, removeListener() {},
          sendCommand: async (method, params = {}) => {
            if (method === 'DOM.getDocument') return { root: { nodeId: 1 } }
            if (method === 'DOM.querySelectorAll') {
              fake.fileSelectors.push(params.selector)
              return { nodeIds: this.menuOpen && params.selector.includes('accept*="image"') ? [2] : [] }
            }
            if (method === 'DOM.setFileInputFiles') this.menuOpen = false
            return {}
          },
        },
        sendInputEvent: (event) => {
          fake.inputEvents.push(event)
          // 窗口被挡在后面时 Chrome 会丢掉合成鼠标事件：用来模拟“坐标点击完全无效”。
          if (fake.mouseIgnored) return
          if (event.type !== 'mouseUp') return
          if (event.x === 10) { this.menuOpen = true; return }
          if (!this.url.includes('/app/')) this.url = `https://gemini.google.com/app/test-${++fake.next}`
          fake.chats.set(this.url, (fake.chats.get(this.url) || 0) + 1)
        },
        executeJavaScript: async (script) => {
          if (script.includes('prompt-wizard:guarded-send')) {
            const mode = fake.guardedModes.shift() || fake.guardedMode
            const model = fake.guardedModel || this.model
            const expected = /"includes":\["Argon"\]/.test(script) ? 'Argon'
              : /"includes":\["Pro"\]/.test(script) ? 'Pro'
                : /"includes":\["Flash-Lite"\]/.test(script) ? 'Flash-Lite'
                  : 'Flash'
            const clicked = mode === 'selected' && model.includes(expected)
            if (clicked) {
              if (!this.url.includes('/app/')) this.url = `https://gemini.google.com/app/test-${++fake.next}`
              fake.chats.set(this.url, (fake.chats.get(this.url) || 0) + 1)
            }
            return { mode, model, clicked }
          }
          if (script.includes('prompt-wizard:chat-mode')) {
            fake.modes.push(script.includes(')("task",') ? 'task' : 'chat')
            return fake.modeState
          }
          if (script.includes('prompt-wizard:model-current')) {
            // 首页刚导航完时模型按钮可能还没渲染；测试里用它模拟“晚一点才出现”。
            if (fake.modelMissingReads > 0) { fake.modelMissingReads -= 1; return { found: false, current: '' } }
            return { found: fake.modelFound, current: this.model }
          }
          if (script.includes('prompt-wizard:model-open')) return true
          if (script.includes('prompt-wizard:model-option')) {
            fake.modelSelections += 1
            // 控制器用 includes/excludes 描述想要的模型，这里按它回填真实菜单文案。
            this.model = /Flash-Lite/.test(script) ? '3.5 Flash-Lite'
              : /Argon/.test(script) ? '4 Argon'
                : /Pro/.test(script) ? '3.1 Pro'
                  : '3.8 Flash'
            return { available: true, clicked: true, label: this.model }
          }
          if (script.includes('accountNode')) return { connected: true, account: 'user@example.com' }
          if (script.includes('promptWizardTurn')) {
            const count = fake.chats.get(this.url) || 0
            fake.responseScripts.push(script)
            // 发送后按队列依次给出回复快照；最后一条会一直重复，模拟稳定输出。
            if (count > 0 && fake.responseQueue.length > 0) {
              const next = fake.responseQueue.length === 1 ? fake.responseQueue[0] : fake.responseQueue.shift()
              return { count, id: `${this.url}-${next.id}`, text: next.text }
            }
            if (fake.refusalTurns.has(count)) return { count, id: `${this.url}-refusal-${count}`, text: '我只是一个语言模型，理解不了这个问题，因此没法帮上忙。' }
            return { count, id: `${this.url}-${count}`, text: count ? '相同回复' : '' }
          }
          if (script.includes('prompt-wizard:uploaded-files')) return 1
          if (script.includes('prompt-wizard:generation-state')) return fake.generationState
          if (script.includes('prompt-wizard:stop-generating')) { fake.stops += 1; return true }
          if (script.includes('Stop response')) return false
          if (script.includes('editor?.value')) return false
          if (script.includes('prompt-wizard:upload-menu-open')) return this.menuOpen
          if (script.includes('prompt-wizard:open-upload-menu')) {
            if (fake.scriptMenuOpens) this.menuOpen = true
            return Boolean(fake.addButton)
          }
          if (script.includes('prompt-wizard:add-file-button')) return fake.addButton
          if (script.includes('prompt-wizard:upload-menu-item')) return fake.uploadMenuItem
          if (script.includes('return { rect:')) return { rect: { x: 100, y: 100 } }
          return true
        },
      }
      fake.windows.push(this)
    }
    isDestroyed() { return false }
    setMenuBarVisibility() {}
    on() {}
    show() {}
    focus() {}
    async loadURL(url) { this.url = url; this.loads.push(url) }
  },
}))

import { GeminiWebController } from './gemini-web.mjs'

it('控制器只为换图/重开加载新对话；连续相同回复不超时；重启恢复原链接', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pw-web-controller-test-'))
  const body = (id) => ({ conversationId: id, messages: [{ role: 'user', content: [
    { type: 'text', text: '测试' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
  ] }] })
  try {
    const controller = new GeminiWebController({ dataDir: dir })
    expect(await controller.submit(body('image-a'))).toBe('相同回复')
    expect(fake.fileSelectors[0]).toBe('input[type="file"][accept*="image"]')
    expect(fake.fileSelectors.length).toBeGreaterThan(1)
    expect(controller.window.model).toBe('3.8 Flash')
    expect(fake.modelSelections).toBe(1)
    const firstUrl = controller.window.url
    const firstLoads = controller.window.loads.length
    expect(await controller.submit(body('image-a'))).toBe('相同回复')
    expect(fake.modelSelections).toBe(1)
    expect(controller.window.url).toBe(firstUrl)
    expect(controller.window.loads.length).toBe(firstLoads)
    await controller.openLogin()
    expect(controller.window.loads.length).toBe(firstLoads)
    await controller.submit(body('image-b'))
    expect(controller.window.url).not.toBe(firstUrl)
    const restored = new GeminiWebController({ dataDir: dir })
    await restored.submit(body('image-a'))
    expect(fake.modelSelections).toBe(2)
    expect(restored.window.url).toBe(firstUrl)
    await restored.resetConversation('image-a')
    await restored.submit(body('image-a'))
    expect(restored.window.url).not.toBe(firstUrl)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 30000)

it('任务模式未确认、未授权或无法识别模型时不发送', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pw-web-strict-test-'))
  const body = { conversationId: 'strict-task', geminiPlan: 'argon-task', messages: [{ role: 'user', content: '测试' }] }
  try {
    const controller = new GeminiWebController({ dataDir: dir })
    fake.modeState = 'absent'
    await expect(controller.submit(body)).rejects.toThrow('无法确认 Gemini 已进入任务模式')
    fake.modeState = 'consent'
    await expect(controller.submit(body)).rejects.toThrow('任务授权尚未完成')
    fake.modeState = 'selected'
    fake.modelFound = false
    await expect(controller.submit(body)).rejects.toThrow('无法确认当前 Gemini 模型')
    expect(fake.chats.get(controller.window.url) || 0).toBe(0)
  } finally {
    fake.modeState = 'selected'
    fake.modelFound = true
    rmSync(dir, { recursive: true, force: true })
  }
}, 45000)

it('网页开始生成图片时立刻停止并报出误判原因', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pw-web-imagegen-test-'))
  const body = { conversationId: 'image-gen', messages: [{ role: 'user', content: [{ type: 'text', text: '测试' }] }] }
  try {
    const controller = new GeminiWebController({ dataDir: dir })
    fake.generationState = { generating: true, image: true }
    fake.stops = 0
    // 误判成生成图片时正文一直是空的：只会显示「正在创建您的图片」。
    fake.responseQueue = [{ id: 'creating-image', text: '' }]
    await expect(controller.submit(body)).rejects.toThrow('误判成「生成图片」')
    expect(fake.stops).toBeGreaterThan(0)
  } finally {
    fake.generationState = { generating: false, image: false }
    fake.responseQueue = []
    rmSync(dir, { recursive: true, force: true })
  }
}, 30000)

it('任务模式的占位状态不会被当成最终回复', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pw-web-pending-test-'))
  const body = { conversationId: 'pending-reply', geminiPlan: 'argon-task', messages: [{ role: 'user', content: '测试' }] }
  try {
    const controller = new GeminiWebController({ dataDir: dir })
    fake.responseQueue = [
      { id: 'thinking-1', text: '正在深入思考…\nGemini 说' },
      { id: 'thinking-2', text: '正在深入思考…\nGemini 说' },
      { id: 'thinking-3', text: '正在深入思考…\nGemini 说' },
      { id: 'done', text: '思考完毕\nGemini 说\n\n有效回答' },
    ]
    await expect(controller.submit(body)).resolves.toBe('思考完毕\nGemini 说\n\n有效回答')
  } finally {
    fake.responseQueue = []
    rmSync(dir, { recursive: true, force: true })
  }
}, 40000)

it('首页模型按钮晚于输入框渲染时等待而不是直接报错', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pw-web-model-wait-test-'))
  const body = { conversationId: 'model-wait', geminiPlan: 'argon-task', messages: [{ role: 'user', content: '测试' }] }
  try {
    const controller = new GeminiWebController({ dataDir: dir })
    fake.modelMissingReads = 3
    await expect(controller.submit(body)).resolves.toBe('相同回复')
    expect(fake.modelMissingReads).toBe(0)
  } finally {
    fake.modelMissingReads = 0
    rmSync(dir, { recursive: true, force: true })
  }
}, 30000)

it('发送动作发现模式漂移时自动恢复任务模式，不使用 Enter 绕过核验', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pw-web-guard-test-'))
  const body = { conversationId: 'guarded-task', geminiPlan: 'argon-task', messages: [{ role: 'user', content: '测试' }] }
  try {
    const controller = new GeminiWebController({ dataDir: dir })
    fake.guardedModes = ['mismatch', 'selected']
    const modeChecks = fake.modes.length
    await expect(controller.submit(body)).resolves.toBe('相同回复')
    expect(fake.modes.length).toBeGreaterThan(modeChecks)
    expect(fake.inputEvents.some(event => event.type === 'keyDown' || event.type === 'keyUp')).toBe(false)
  } finally {
    fake.guardedMode = 'selected'
    fake.guardedModes = []
    fake.guardedModel = ''
    rmSync(dir, { recursive: true, force: true })
  }
}, 35000)

it('Argon 拒答后只报告原始失败，一次发送且不切换到 Flash', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pw-web-retry-test-'))
  const body = (id) => ({ conversationId: id, geminiPlan: 'argon', messages: [{ role: 'user', content: [{ type: 'text', text: '测试' }] }] })
  try {
    fake.refusalTurns = new Set([1, 2])
    const pickedBefore = fake.modelSelections
    const controller = new GeminiWebController({ dataDir: dir })
    await expect(controller.submit(body('image-retry'))).rejects.toThrow('未切换模型。网页回复：我只是一个语言模型')
    expect(fake.modelSelections).toBe(pickedBefore)
    expect(controller.window.model).toBe('Argon')
    expect(fake.chats.get(controller.window.url)).toBe(1)
  } finally {
    fake.refusalTurns = new Set()
    rmSync(dir, { recursive: true, force: true })
  }
}, 30000)

const uploadBody = (id) => ({ conversationId: id, messages: [{ role: 'user', content: [
  { type: 'text', text: '测试' },
  { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
] }] })

it('浏览器窗口不在前台、坐标点击全被丢弃时，仍能用元素 click() 打开上传菜单并把图交上去', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pw-web-upload-offscreen-test-'))
  try {
    // 窗口被挡在后面时 Chrome 会丢掉合成鼠标事件，这正是“找不到上传文件”的现场。
    fake.mouseIgnored = true
    const controller = new GeminiWebController({ dataDir: dir })
    await expect(controller.submit(uploadBody('upload-offscreen'))).resolves.toBe('相同回复')
    expect(fake.fileSelectors).toContain('input[type="file"][accept*="image"]')
  } finally {
    fake.mouseIgnored = false
    rmSync(dir, { recursive: true, force: true })
  }
}, 40000)

it('元素 click() 打不开上传菜单时，还会退回坐标点击重试一次', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pw-web-upload-fallback-test-'))
  try {
    fake.scriptMenuOpens = false
    const controller = new GeminiWebController({ dataDir: dir })
    await expect(controller.submit(uploadBody('upload-fallback'))).resolves.toBe('相同回复')
    expect(fake.inputEvents.some((event) => event.type === 'mouseUp' && event.x === 10)).toBe(true)
  } finally {
    fake.scriptMenuOpens = true
    rmSync(dir, { recursive: true, force: true })
  }
}, 45000)

it('抓取回复时把 Gemini 的来源角标排除在正文之外', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pw-web-source-chip-test-'))
  const body = { conversationId: 'source-chip', messages: [{ role: 'user', content: '测试' }] }
  try {
    fake.responseScripts = []
    const controller = new GeminiWebController({ dataDir: dir })
    await expect(controller.submit(body)).resolves.toBe('相同回复')
    // “JPG +2”这类来源角标挂在回复段落下面，读 innerText 时必须先把它藏起来。
    expect(fake.responseScripts.some((script) => script.includes('source-label-container'))).toBe(true)
  } finally {
    fake.responseScripts = []
    rmSync(dir, { recursive: true, force: true })
  }
}, 30000)

it('严格按方案选择模型；换方案重开上下文；未知方案拒绝提交', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pw-web-plan-test-'))
  const body = (id, geminiPlan) => ({ conversationId: id, geminiPlan, messages: [{ role: 'user', content: [{ type: 'text', text: '测试' }] }] })
  try {
    const controller = new GeminiWebController({ dataDir: dir })
    expect(await controller.submit(body('image-plan-pro', 'pro'))).toBe('相同回复')
    expect(controller.window.model).toBe('3.1 Pro')
    const proUrl = controller.window.url
    expect(await controller.submit(body('image-plan-pro', 'lite'))).toBe('相同回复')
    expect(controller.window.url).not.toBe(proUrl)
    expect(controller.window.model).toBe('3.5 Flash-Lite')
    await expect(controller.submit(body('image-plan-default', 'unknown-plan'))).rejects.toThrow('未知的 Gemini 网页方案')
    expect(await controller.submit(body('image-task', 'argon-task'))).toBe('相同回复')
    expect(controller.window.model).toBe('4 Argon')
    expect(fake.modes.at(-1)).toBe('task')
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 30000)
