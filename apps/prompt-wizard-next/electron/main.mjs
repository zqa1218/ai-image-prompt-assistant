import { app, BrowserWindow, ipcMain, Menu, screen, shell, safeStorage, Tray } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createWorkbenchServer } from '../../../packages/http/server.mjs'
import { GeminiWebController } from './gemini-web.mjs'
import { ChatGptWebController } from './chatgpt-web.mjs'
import { installPhotoshopPlugin } from './photoshop-plugin.mjs'
import { clampBounds, readWindowState, saveWindowState } from './window-state.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const wizardPort = Number(process.env.PW_DESKTOP_PORT || 8791)

app.setName('MJ Banana 创作工作台候选版')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let wizardWindow = null
  let workbenchWindow = null
  let tray = null
  let workbench = null
  let closeWizardServer = null
  let quitting = false
  let shutdownStarted = false

  const show = window => {
    if (!window || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  app.on('second-instance', () => show(wizardWindow))

  app.whenReady().then(async () => {
    const userData = app.getPath('userData')
    const candidateData = path.join(userData, 'candidate-data')
    const appData = app.getPath('appData')
    const connectorFile = path.join(appData, 'MJStudioCandidate', 'connector.json')

    process.env.PW_WEB_PORT = String(wizardPort)
    process.env.PROMPT_WIZARD_DATA_DIR = path.join(candidateData, 'wizard')
    process.env.PROMPT_WIZARD_BRIDGE_DIR = path.join(appData, 'MJStudioCandidate')
    process.env.MJ_STUDIO_DATA_DIR = path.join(candidateData, 'workbench')
    process.env.MJ_STUDIO_CONNECTOR_FILE = connectorFile

    const icon = path.join(here, '..', 'assets', 'icon.ico')
    globalThis.promptWizardSafeStorage = safeStorage
    globalThis.promptWizardGeminiWeb = new GeminiWebController({
      icon,
      dataDir: path.join(candidateData, 'wizard'),
      browserProfileDir: path.join(appData, 'MJStudioCandidate', 'gemini-browser'),
      browserExecutable: process.env.PW_BROWSER_PATH || '',
    })
    globalThis.promptWizardChatGptWeb = new ChatGptWebController({
      icon,
      dataDir: path.join(candidateData, 'wizard'),
      browserProfileDir: path.join(appData, 'MJStudioCandidate', 'chatgpt-browser'),
      browserExecutable: process.env.PW_BROWSER_PATH || '',
    })

    try {
      const pluginPath = await installPhotoshopPlugin({ app, projectRoot: path.join(here, '..') })
      console.log(`[candidate] Photoshop Link 候选插件已同步：${pluginPath}`)
    } catch (error) {
      console.error('[candidate] Photoshop Link 候选插件同步失败：', error)
    }

    const serverUrl = pathToFileURL(path.join(here, '..', 'server', 'index.mjs')).href
    const { ready, closeServer } = await import(serverUrl)
    await ready
    closeWizardServer = closeServer
    const bridgeModuleUrl = pathToFileURL(path.join(here, '..', 'server', 'photoshop-bridge.mjs')).href
    const { photoshopBridgeInstance } = await import(bridgeModuleUrl)
    const sharedPhotoshopBridge = photoshopBridgeInstance()

    workbench = createWorkbenchServer({
      dataRoot: process.env.MJ_STUDIO_DATA_DIR,
      port: 0,
      connectorFile,
      photoshopBridge: sharedPhotoshopBridge,
    })
    await workbench.ready
    console.log(`[candidate] MJ / Banana 工作台已启动：${workbench.url}`)

    const commonWebPreferences = {
      contextIsolation: true,
      sandbox: true,
      preload: path.join(here, 'preload.cjs'),
    }
    const guardExternalLinks = window => window.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) void shell.openExternal(url)
      return { action: 'deny' }
    })

    const boundsFile = path.join(userData, 'window-state.json')
    const storedWindow = readWindowState(boundsFile)
    let shellMode = storedWindow.mode === 'narrow' ? 'narrow' : 'wide'
    const displayFor = bounds => bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)
      ? screen.getDisplayNearestPoint({ x: Math.round(bounds.x), y: Math.round(bounds.y) })
      : screen.getPrimaryDisplay()
    const setMode = mode => {
      if (!wizardWindow || !['wide', 'narrow'].includes(mode)) return null
      storedWindow[shellMode] = wizardWindow.getBounds()
      shellMode = mode
      const candidate = storedWindow[mode] ?? { ...wizardWindow.getBounds(), width: mode === 'narrow' ? 400 : 1100 }
      const target = clampBounds(candidate, displayFor(candidate).workArea)
      wizardWindow.setBounds(target)
      return { ...target, narrow: mode === 'narrow' }
    }

    wizardWindow = new BrowserWindow({
      ...clampBounds(storedWindow[shellMode], displayFor(storedWindow[shellMode]).workArea),
      minWidth: shellMode === 'narrow' ? 360 : 760,
      minHeight: 480,
      title: 'MJ Banana 创作工作台 · 提示词向导',
      icon,
      webPreferences: commonWebPreferences,
    })
    wizardWindow.removeMenu()
    guardExternalLinks(wizardWindow)
    wizardWindow.on('focus', () => wizardWindow?.webContents.focus())

    const openWorkbench = async () => {
      if (!workbenchWindow || workbenchWindow.isDestroyed()) {
        workbenchWindow = new BrowserWindow({
          width: 1280,
          height: 860,
          minWidth: 760,
          minHeight: 560,
          title: 'MJ / Banana 创作工作台',
          icon,
          webPreferences: commonWebPreferences,
        })
        workbenchWindow.removeMenu()
        guardExternalLinks(workbenchWindow)
        workbenchWindow.on('close', event => {
          if (!quitting) { event.preventDefault(); workbenchWindow.hide() }
        })
        workbenchWindow.on('closed', () => { workbenchWindow = null })
        await workbenchWindow.loadURL(workbench.url)
      }
      show(workbenchWindow)
      return { url: workbench.url }
    }

    ipcMain.handle('shell:open-workbench', openWorkbench)
    ipcMain.handle('shell:mode', (_event, mode) => {
      if (!['wide', 'narrow'].includes(mode)) throw new Error('未知窗口模式')
      wizardWindow?.setMinimumSize(mode === 'narrow' ? 360 : 760, 480)
      return setMode(mode)
    })
    ipcMain.handle('shell:on-top', (_event, value) => {
      wizardWindow?.setAlwaysOnTop(Boolean(value))
      return wizardWindow?.isAlwaysOnTop() ?? false
    })
    ipcMain.handle('shell:state', () => wizardWindow ? {
      ...wizardWindow.getBounds(),
      narrow: shellMode === 'narrow',
      alwaysOnTop: wizardWindow.isAlwaysOnTop(),
    } : null)

    let boundsTimer
    const persistBounds = () => {
      if (!wizardWindow || wizardWindow.isDestroyed() || wizardWindow.isMinimized() || wizardWindow.isMaximized()) return
      storedWindow[shellMode] = wizardWindow.getBounds()
      storedWindow.mode = shellMode
      try { saveWindowState(boundsFile, storedWindow) } catch (error) { console.error('[candidate] 窗口状态保存失败', error) }
    }
    const rememberBounds = () => { clearTimeout(boundsTimer); boundsTimer = setTimeout(persistBounds, 300) }
    wizardWindow.on('move', rememberBounds)
    wizardWindow.on('resize', rememberBounds)
    wizardWindow.on('close', event => {
      clearTimeout(boundsTimer)
      persistBounds()
      if (!quitting) { event.preventDefault(); wizardWindow.hide() }
    })
    wizardWindow.on('closed', () => { wizardWindow = null })
    screen.on('display-removed', () => {
      if (wizardWindow) wizardWindow.setBounds(clampBounds(wizardWindow.getBounds(), displayFor(wizardWindow.getBounds()).workArea))
    })

    tray = new Tray(icon)
    tray.setToolTip('MJ Banana 创作工作台候选版')
    tray.on('double-click', () => show(wizardWindow))
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '提示词向导', click: () => show(wizardWindow) },
      { label: 'MJ / Banana 工作台', click: () => { void openWorkbench() } },
      { type: 'separator' },
      { label: '向导宽模式', click: () => { wizardWindow?.setMinimumSize(760, 480); setMode('wide'); show(wizardWindow) } },
      { label: '向导窄模式', click: () => { wizardWindow?.setMinimumSize(360, 480); setMode('narrow'); show(wizardWindow) } },
      { type: 'separator' },
      { label: '退出', click: () => { quitting = true; app.quit() } },
    ]))

    await wizardWindow.loadURL(`http://127.0.0.1:${wizardPort}`)
    if (process.env.PW_CANDIDATE_SMOKE === '1') {
      await openWorkbench()
      if (process.env.PW_CANDIDATE_SMOKE_FILE && path.isAbsolute(process.env.PW_CANDIDATE_SMOKE_FILE)) {
        fs.mkdirSync(path.dirname(process.env.PW_CANDIDATE_SMOKE_FILE), { recursive: true })
        fs.writeFileSync(process.env.PW_CANDIDATE_SMOKE_FILE, JSON.stringify({
          wizardUrl: `http://127.0.0.1:${wizardPort}`,
          workbenchUrl: workbench.url,
          pid: process.pid,
          checkedAt: new Date().toISOString(),
        }, null, 2))
      }
      console.log('[candidate] 打包冒烟模式已打开向导与工作台，准备正常退出')
      setTimeout(() => app.quit(), 750)
    }
  }).catch(error => {
    console.error('[candidate] 启动失败：', error)
    app.exit(1)
  })

  app.on('window-all-closed', () => { if (process.platform !== 'win32') app.quit() })
  app.on('before-quit', event => {
    quitting = true
    if (shutdownStarted) return
    shutdownStarted = true
    event.preventDefault()
    try { workbenchWindow?.destroy() } catch {}
    try { wizardWindow?.destroy() } catch {}
    Promise.allSettled([
      Promise.resolve(workbench?.close?.()),
      Promise.resolve(closeWizardServer?.()),
    ]).then(results => {
      for (const result of results) if (result.status === 'rejected') console.error('[candidate] 关闭本机服务失败：', result.reason)
    }).finally(() => {
      tray?.destroy()
      void globalThis.promptWizardGeminiWeb?.window?.close?.()
      void globalThis.promptWizardChatGptWeb?.window?.close?.()
      app.quit()
    })
  })
}
