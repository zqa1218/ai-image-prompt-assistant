import { app, BrowserWindow, shell, safeStorage } from 'electron'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { GeminiWebController } from './gemini-web.mjs'
import { ChatGptWebController } from './chatgpt-web.mjs'
import { installPhotoshopPlugin } from './photoshop-plugin.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const port = 8787

app.setName('AI修图提示词助手')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let window = null

  app.on('second-instance', () => {
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })

  app.whenReady().then(async () => {
    process.env.PW_WEB_PORT = String(port)
    process.env.PROMPT_WIZARD_DATA_DIR = app.getPath('userData')
    process.env.PROMPT_WIZARD_BRIDGE_DIR = path.join(app.getPath('appData'), 'PromptWizard')

    const icon = path.join(here, '..', 'assets', 'icon.ico')
    globalThis.promptWizardSafeStorage = safeStorage
    globalThis.promptWizardGeminiWeb = new GeminiWebController({
      icon,
      dataDir: app.getPath('userData'),
      // Gemini 会话跑在真实 Chrome / Edge 里，配置目录单独放，不碰用户平时的浏览器资料。
      browserProfileDir: path.join(app.getPath('appData'), 'PromptWizard', 'gemini-browser'),
      browserExecutable: process.env.PW_BROWSER_PATH || '',
    })
    // ChatGPT 网页通道：同样用独立配置目录，登录态与 Gemini 互不影响。
    globalThis.promptWizardChatGptWeb = new ChatGptWebController({
      icon,
      dataDir: app.getPath('userData'),
      browserProfileDir: path.join(app.getPath('appData'), 'PromptWizard', 'chatgpt-browser'),
      browserExecutable: process.env.PW_BROWSER_PATH || '',
    })

    try {
      const pluginPath = await installPhotoshopPlugin({ app, projectRoot: path.join(here, '..') })
      console.log(`[prompt-wizard] Photoshop Link 已同步：${pluginPath}`)
    } catch (error) {
      console.error('[prompt-wizard] Photoshop Link 自动同步失败：', error)
    }

    const serverUrl = pathToFileURL(path.join(here, '..', 'server', 'index.mjs')).href
    const { ready } = await import(serverUrl)
    await ready

    window = new BrowserWindow({
      width: 1100,
      height: 820,
      minWidth: 760,
      minHeight: 620,
      title: 'AI修图提示词助手',
      icon,
      webPreferences: { contextIsolation: true, sandbox: true },
    })
    window.removeMenu()
    // Windows 上原生模态框（alert/confirm）关闭后偶尔不把键盘焦点还给页面，
    // 表现是「点得动但打不了字」。渲染进程里已经禁用原生对话框，这里再兜一层：
    // 窗口每次重新拿到焦点，就把键盘焦点交回页面。
    window.on('focus', () => window?.webContents.focus())
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) void shell.openExternal(url)
      return { action: 'deny' }
    })
    await window.loadURL(`http://127.0.0.1:${port}`)
    window.on('closed', () => { window = null })
  })

  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => {
    void globalThis.promptWizardGeminiWeb?.window?.close?.()
    void globalThis.promptWizardChatGptWeb?.window?.close?.()
  })
}
