import { app, BrowserWindow, ipcMain, screen, shell, safeStorage, Tray, Menu } from 'electron'
import path from 'node:path'
import { attachHandoff } from './handoff.mjs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { GeminiWebController } from './gemini-web.mjs'
import { ChatGptWebController } from './chatgpt-web.mjs'
import { installPhotoshopPlugin } from './photoshop-plugin.mjs'
import { clampBounds, readWindowState, saveWindowState } from './window-state.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const port = 8787

app.setName('AI修图提示词助手')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let window = null
  let tray, companion

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

    const boundsFile = path.join(app.getPath('userData'), 'window-state.json')
    const storedWindow = readWindowState(boundsFile)
    let shellMode = storedWindow.mode === 'narrow' ? 'narrow' : 'wide'
    const displayFor = bounds => bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)
      ? screen.getDisplayNearestPoint({x:Math.round(bounds.x),y:Math.round(bounds.y)}) : screen.getPrimaryDisplay()
    const remembered = storedWindow[shellMode]
    window = new BrowserWindow({
      ...clampBounds(remembered, displayFor(remembered).workArea),
      minWidth: 360,
      minHeight: 480,
      title: 'AI修图提示词助手',
      icon,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        preload: path.join(here, 'preload.cjs'),
      },
    })
    // 宽 / 窄两种外壳：窄模式是伴随面板（约 400px），宽模式回到工作台宽度。
    // 宽度由主进程夹在 360–1920 且不超过当前屏幕可用宽度，页面传什么都不越界。
    const WIDE_WIDTH = 1100
    const NARROW_WIDTH = 400
    // 记住首次的完整 bounds：非 100% DPI 下，按 getBounds→setBounds 往返取整会每次漂 1px，
    // 所以切窄只改宽度、切宽整份还原，不再拿"当前高度"当基准。
    let baseBounds = null
    const rememberBase = () => {
      if (!window) return
      const bounds = window.getBounds()
      // 收窄状态下不要覆盖基准，避免把 400 宽记成基准
      if (!baseBounds || bounds.width > NARROW_WIDTH + 1) baseBounds = bounds
    }
    ipcMain.handle('shell:mode', (_event, mode) => {
      if (!window) return null
      if (!['wide', 'narrow'].includes(mode)) throw new Error('未知窗口模式')
      if (mode === shellMode) return { narrow: mode === 'narrow', ...window.getBounds() }
      storedWindow[shellMode] = window.getBounds()
      rememberBase()
      const narrow = mode === 'narrow'
      const base = baseBounds ?? window.getBounds()
      const targetWidth = Math.min(Math.max(narrow ? NARROW_WIDTH : Math.max(base.width, WIDE_WIDTH), 360), 1920)
      window.setMinimumSize(360, 480)
      const candidate = storedWindow[mode] ?? { ...window.getBounds(), width: targetWidth }
      const target = clampBounds(candidate, displayFor(candidate).workArea)
      shellMode = mode
      window.setBounds(target)
      return { width: target.width, height: target.height, narrow, base }
    })
    ipcMain.handle('shell:on-top', (_event, value) => {
      window?.setAlwaysOnTop(Boolean(value))
      return window?.isAlwaysOnTop() ?? false
    })
    ipcMain.handle('shell:state', () => {
      if (!window) return null
      const [width, height] = window.getSize()
      return { width, height, narrow: shellMode === 'narrow', alwaysOnTop: window.isAlwaysOnTop(), display: screen.getPrimaryDisplay().workAreaSize }
    })

    let boundsTimer
    const persistBounds = () => {
      if (!window || window.isDestroyed() || window.isMinimized() || window.isMaximized()) return
      storedWindow[shellMode] = window.getBounds()
      storedWindow.mode = shellMode
      try { saveWindowState(boundsFile, storedWindow) } catch (error) { console.error('窗口位置保存失败', error.message) }
    }
    const rememberWindow = () => { clearTimeout(boundsTimer); boundsTimer = setTimeout(persistBounds, 300) }
    window.on('move', rememberWindow)
    window.on('resize', rememberWindow)
    window.on('close', () => { clearTimeout(boundsTimer); persistBounds() })
    screen.on('display-removed', () => { if (window) window.setBounds(clampBounds(window.getBounds(), displayFor(window.getBounds()).workArea)) })

    // 只保留「复制并切到耀 AI」用到的窗口列举与激活；跟随已移除
    attachHandoff({ app, ipcMain })
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
