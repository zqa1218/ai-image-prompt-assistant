import { it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const fake = vi.hoisted(() => ({ windows: [], chats: new Map(), next: 0, modelSelections: 0, fileSelectors: [], refusalTurns: new Set() }))
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
          if (event.type !== 'mouseUp') return
          if (event.x === 10) { this.menuOpen = true; return }
          if (!this.url.includes('/app/')) this.url = `https://gemini.google.com/app/test-${++fake.next}`
          fake.chats.set(this.url, (fake.chats.get(this.url) || 0) + 1)
        },
        executeJavaScript: async (script) => {
          if (script.includes('prompt-wizard:model-current')) return { found: true, current: this.model }
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
            if (fake.refusalTurns.has(count)) return { count, id: `${this.url}-refusal-${count}`, text: '我只是一个语言模型，理解不了这个问题，因此没法帮上忙。' }
            return { count, id: `${this.url}-${count}`, text: count ? '相同回复' : '' }
          }
          if (script.includes('prompt-wizard:uploaded-files')) return 1
          if (script.includes('Stop response')) return false
          if (script.includes('editor?.value')) return false
          if (script.includes('上传和工具|添加文件')) return { x: 10, y: 10 }
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

it('遇到网页端的能力否认会自动换模型重试，直到拿到有效回答', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pw-web-retry-test-'))
  const body = (id) => ({ conversationId: id, messages: [{ role: 'user', content: [{ type: 'text', text: '测试' }] }] })
  try {
    // 第 1、2 轮（Flash、Flash-Lite）都只回能力否认，第 3 轮换回 Flash 才给出正常回答。
    fake.refusalTurns = new Set([1, 2])
    const pickedBefore = fake.modelSelections
    const controller = new GeminiWebController({ dataDir: dir })
    expect(await controller.submit(body('image-retry'))).toBe('相同回复')
    expect(fake.modelSelections).toBe(pickedBefore + 3)
  } finally {
    fake.refusalTurns = new Set()
    rmSync(dir, { recursive: true, force: true })
  }
}, 30000)

it('可以按所选网页方案切换模型链', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pw-web-plan-test-'))
  const body = (id, geminiPlan) => ({ conversationId: id, geminiPlan, messages: [{ role: 'user', content: [{ type: 'text', text: '测试' }] }] })
  try {
    const controller = new GeminiWebController({ dataDir: dir })
    expect(await controller.submit(body('image-plan-pro', 'pro'))).toBe('相同回复')
    expect(controller.window.model).toBe('3.1 Pro')
    expect(await controller.submit(body('image-plan-lite', 'lite'))).toBe('相同回复')
    expect(controller.window.model).toBe('3.5 Flash-Lite')
    expect(await controller.submit(body('image-plan-default', 'unknown-plan'))).toBe('相同回复')
    expect(controller.window.model).toBe('3.8 Flash')
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 30000)
