import { it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const fake = vi.hoisted(() => ({ windows: [], chats: new Map(), next: 0 }))
vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
  BrowserWindow: class {
    constructor() {
      this.url = ''
      this.loads = []
      this.webContents = {
        setUserAgent() {}, setWindowOpenHandler() {},
        getURL: () => this.url,
        insertText: async () => {},
        sendInputEvent: (event) => {
          if (event.type !== 'mouseUp') return
          if (!this.url.includes('/app/')) this.url = `https://gemini.google.com/app/test-${++fake.next}`
          fake.chats.set(this.url, (fake.chats.get(this.url) || 0) + 1)
        },
        executeJavaScript: async (script) => {
          if (script.includes('accountNode')) return { connected: true, account: 'user@example.com' }
          if (script.includes('promptWizardTurn')) {
            const count = fake.chats.get(this.url) || 0
            return { count, id: `${this.url}-${count}`, text: count ? '相同回复' : '' }
          }
          if (script.includes('Stop response')) return false
          if (script.includes('editor?.value')) return false
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
  const body = (id) => ({ conversationId: id, messages: [{ role: 'user', content: '测试' }] })
  try {
    const controller = new GeminiWebController({ dataDir: dir })
    expect(await controller.submit(body('image-a'))).toBe('相同回复')
    const firstUrl = controller.window.url
    const firstLoads = controller.window.loads.length
    expect(await controller.submit(body('image-a'))).toBe('相同回复')
    expect(controller.window.url).toBe(firstUrl)
    expect(controller.window.loads.length).toBe(firstLoads)
    await controller.openLogin()
    expect(controller.window.loads.length).toBe(firstLoads)
    await controller.submit(body('image-b'))
    expect(controller.window.url).not.toBe(firstUrl)
    const restored = new GeminiWebController({ dataDir: dir })
    await restored.submit(body('image-a'))
    expect(restored.window.url).toBe(firstUrl)
    await restored.resetConversation('image-a')
    await restored.submit(body('image-a'))
    expect(restored.window.url).not.toBe(firstUrl)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 30000)
