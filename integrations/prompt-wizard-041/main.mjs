import { app, BrowserWindow, ipcMain, screen, shell, safeStorage, Tray, Menu, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GeminiWebController } from './gemini-web.mjs';
import { ChatGptWebController } from './chatgpt-web.mjs';
import { attachHandoff } from './handoff.mjs';
import { installPhotoshopPlugin } from './photoshop-plugin.mjs';
import { clampBounds, readWindowState, saveWindowState } from './window-state.mjs';
import { createWorkbenchServer } from '../../../packages/http/server.mjs';
import { assertWizardSender, createInstalledHandoff } from '../../../integrations/prompt-wizard-041/handoff.mjs';

import { MjRelay, MjRelaySettings } from '../../../packages/adapters/mj-relay.mjs';
import { makeMjBrowser } from '../../../integrations/prompt-wizard-041/mj-browser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
app.setName('提示词助手 0.4.1 工作台版');
const testRoot = process.env.PW041_TEST_ROOT;
if (testRoot && path.isAbsolute(testRoot)) app.setPath('userData', path.join(testRoot, 'electron'));
let wizardWindow, workbenchWindow, tray, workbench, closeWizard;
let quitting = false, shuttingDown = false, shutdownDone = false;
const show = window => { if (!window || window.isDestroyed()) return; if (window.isMinimized()) window.restore(); window.show(); window.focus(); };
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => show(wizardWindow));
  app.whenReady().then(async () => {
    const userData = app.getPath('userData');
    const bridgeDir = testRoot ? path.join(testRoot, 'bridge') : path.join(app.getPath('appData'), 'PromptWizardWorkbench041');
    const dataDir = path.join(userData, 'wizard');
    fs.mkdirSync(dataDir, { recursive: true });
    // Copy preferences/archives once, with exclusive destinations. Never share a writable data directory.
    const marker = path.join(dataDir, 'migration-041.json');
    if (!testRoot && !fs.existsSync(marker)) {
      const old = path.join(app.getPath('appData'), 'AI修图提示词助手');
      const copied = [];
      for (const name of ['model-settings.json', 'archives']) {
        if (fs.existsSync(path.join(old, name)) && !fs.existsSync(path.join(dataDir, name))) {
          fs.cpSync(path.join(old, name), path.join(dataDir, name), { recursive: true, force: false, errorOnExist: true }); copied.push(name);
        }
      }
      fs.writeFileSync(marker, JSON.stringify({ from: old, copied, date: new Date().toISOString() }));
    }
    // Stable origin preserves the installed frontend's local presets and UI preferences.
    const port = Number(process.env.PW041_PORT || 8792);
    const wizardUrl = `http://127.0.0.1:${port}`;
    process.env.PW_WEB_PORT = String(port); delete process.env.PW_API_PORT;
    process.env.PROMPT_WIZARD_DATA_DIR = dataDir;
    process.env.PROMPT_WIZARD_BRIDGE_DIR = bridgeDir;
    const icon = path.join(here, '..', 'assets', 'icon.ico');
    globalThis.promptWizardSafeStorage = safeStorage;
    // 给 window-placement.mjs 用：网页登录窗口要放到用户正在用的屏幕上（见 electron/cdp-browser.mjs 补丁）。
    globalThis.promptWizardWorkAreas = () => screen.getAllDisplays().map(display => display.workArea);
    globalThis.promptWizardActiveWorkArea = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    globalThis.promptWizardGeminiWeb = new GeminiWebController({ icon, dataDir, browserProfileDir: path.join(bridgeDir, 'gemini-browser'), browserExecutable: process.env.PW_BROWSER_PATH || '' });
    globalThis.promptWizardChatGptWeb = new ChatGptWebController({ icon, dataDir, browserProfileDir: path.join(bridgeDir, 'chatgpt-browser'), browserExecutable: process.env.PW_BROWSER_PATH || '' });
    if (!testRoot) {
      try { await installPhotoshopPlugin({ app, projectRoot: path.join(here, '..') }); }
      catch (error) { console.error('[pw041] Photoshop 面板暂存失败', error.message); }
    }
    const serverModule = await import(pathToFileURL(path.join(here, '..', 'server/index.mjs')).href);
    await serverModule.ready; closeWizard = serverModule.closeServer;
    const connectorFile = path.join(bridgeDir, 'connector.json');
    workbench = createWorkbenchServer({ dataRoot: path.join(userData, 'workbench'), port: 0, connectorFile });
    await workbench.ready;
    const mjBrowser = makeMjBrowser();
    const mjSettings = new MjRelaySettings(path.join(userData, 'mj-relay-settings.json'));
    const mj = new MjRelay(workbench.store, mjBrowser, mjSettings);
    // Enabling auto-submit always goes through a native warning the page cannot answer for the user.
    const setAutoSubmit = async enabled => {
      if (enabled !== true) return mjSettings.setAutoSubmit(false);
      const { response } = await dialog.showMessageBox(workbenchWindow, {
        type: 'warning', title: '开启 MJ 自动提交', noLink: true, defaultId: 0, cancelId: 0,
        buttons: ['取消', '我了解风险，开启自动提交'],
        message: '自动提交可能违反 Midjourney 服务条款',
        detail: 'Midjourney 的服务条款禁止用自动化工具或脚本访问其服务。开启后，工作台会在独立 MJ 窗口中替你按下回车，提交不带生产素材的纯文字任务，并自动下载四宫格。账号可能因此被警告或封禁，每次提交都会消耗额度。此功能尚未在真实账号上验证。\n\n关闭时（默认），工作台只把提示词填入官网输入框，由你亲自核对并按回车，之后自动识别任务链接并取图。',
      });
      return response === 1 ? mjSettings.setAutoSubmit(true) : mjSettings.read();
    };
    for (const [name, handler] of Object.entries({
      open: () => mjBrowser.open(),
      generate: (id, revision) => mj.generate(id, revision),
      collect: (id, runId) => mj.collect(id, runId),
      settings: () => mjSettings.read(),
      'set-auto-submit': setAutoSubmit,
      pending: (id, revision) => mj.pendingAttempt(id, revision),
      'clear-pending': (id, revision) => mj.clearPending(id, revision),
    })) ipcMain.handle('mj:' + name, (event, ...args) => {
      assertWizardSender(event, workbenchWindow, workbench.url);
      return handler(...args);
    });
    app.once('will-quit', () => mjBrowser.close());
    const boundsFile = path.join(userData, 'window-state.json');
    const stored = readWindowState(boundsFile);
    let mode = stored.mode === 'narrow' ? 'narrow' : 'wide';
    const area = bounds => bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)
      ? screen.getDisplayNearestPoint({ x: Math.round(bounds.x), y: Math.round(bounds.y) }).workArea : screen.getPrimaryDisplay().workArea;
    const protect = (window, origin) => {
      window.removeMenu();
      window.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://')) void shell.openExternal(url); return { action: 'deny' }; });
      window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
    };
    wizardWindow = new BrowserWindow({ ...clampBounds(stored[mode], area(stored[mode])), minWidth: 360, minHeight: 480, icon,
      title: '提示词助手 0.4.1 工作台版', show: process.env.PW041_SMOKE !== '1',
      webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(here, 'preload.cjs') } });
    protect(wizardWindow, wizardUrl);
    wizardWindow.on('focus', () => wizardWindow?.webContents.focus());
    let opening;
    const openWorkbench = async taskId => {
      if (opening) await opening;
      const url = new URL(workbench.url);
      if (taskId) { url.searchParams.set('task', taskId); url.searchParams.set('pane', 'workspace'); }
      if (!workbenchWindow || workbenchWindow.isDestroyed()) {
        workbenchWindow = new BrowserWindow({ width: 1280, height: 860, minWidth: 760, minHeight: 560, icon,
          title: 'MJ / Banana 工作台', show: process.env.PW041_SMOKE !== '1', webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(here, 'workbench-preload.cjs') } });
        protect(workbenchWindow, workbench.url);
        workbenchWindow.on('closed', () => { workbenchWindow = null; if (!quitting && process.env.PW041_SMOKE !== '1') show(wizardWindow); });
        opening = workbenchWindow.loadURL(url.href);
      } else if (taskId) {
        // Refresh only when handing off a task; ordinary Open preserves unsaved workbench inputs.
        opening = workbenchWindow.loadURL(url.href);
      }
      try { await opening; } finally { opening = null; }
      if (process.env.PW041_SMOKE !== '1') { wizardWindow?.hide(); show(workbenchWindow); }
      return { url: url.href, taskId: taskId ?? null };
    };
    const handoff = createInstalledHandoff({ workbench, connectorFile, openWorkbench });
    const secureHandle = (channel, handler) => ipcMain.handle(channel, (event, ...args) => { assertWizardSender(event, wizardWindow, wizardUrl); return handler(...args); });
    secureHandle('workbench:open', () => openWorkbench());
    secureHandle('workbench:import', handoff);
    ipcMain.handle('workbench:show-wizard', event => {
      assertWizardSender(event, workbenchWindow, workbench.url);
      show(wizardWindow); workbenchWindow?.hide(); return true;
    });
    const setMode = value => {
      if (!['wide', 'narrow'].includes(value)) throw new Error('未知窗口模式');
      if (value !== mode) { stored[mode] = wizardWindow.getBounds(); mode = value; const bounds = stored[mode] ?? { ...wizardWindow.getBounds(), width: mode === 'narrow' ? 400 : 1100 }; wizardWindow.setBounds(clampBounds(bounds, area(bounds))); }
      return { ...wizardWindow.getBounds(), narrow: mode === 'narrow' };
    };
    secureHandle('shell:mode', setMode);
    secureHandle('shell:on-top', value => { wizardWindow.setAlwaysOnTop(Boolean(value)); return wizardWindow.isAlwaysOnTop(); });
    secureHandle('shell:state', () => ({ ...wizardWindow.getBounds(), narrow: mode === 'narrow', alwaysOnTop: wizardWindow.isAlwaysOnTop(), display: screen.getPrimaryDisplay().workAreaSize }));
    secureHandle('pose:pick-dir', async () => { const result = await dialog.showOpenDialog(wizardWindow, { title: '选择姿势参考图下载目录', properties: ['openDirectory', 'createDirectory'] }); return result.canceled ? null : result.filePaths[0]; });
    secureHandle('pose:reveal-dir', dir => { if (typeof dir === 'string' && dir && fs.existsSync(dir)) return shell.openPath(dir); return false; });
    attachHandoff({ app, ipcMain, psPath: path.join(here.replace('app.asar', 'app.asar.unpacked'), 'window-link.ps1') });
    let timer;
    const persist = () => { if (!wizardWindow || wizardWindow.isDestroyed() || wizardWindow.isMinimized() || wizardWindow.isMaximized()) return; stored[mode] = wizardWindow.getBounds(); stored.mode = mode; saveWindowState(boundsFile, stored); };
    const remember = () => { clearTimeout(timer); timer = setTimeout(persist, 300); };
    wizardWindow.on('move', remember); wizardWindow.on('resize', remember);
    wizardWindow.on('close', event => { clearTimeout(timer); persist(); if (!quitting) { event.preventDefault(); wizardWindow.hide(); } });
    wizardWindow.on('closed', () => { wizardWindow = null; });
    screen.on('display-removed', () => { if (wizardWindow) wizardWindow.setBounds(clampBounds(wizardWindow.getBounds(), area(wizardWindow.getBounds()))); });
    tray = new Tray(icon); tray.setToolTip('提示词助手 0.4.1 工作台版'); tray.on('double-click', () => show(wizardWindow));
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '提示词助手', click: () => show(wizardWindow) },
      { label: '打开工作台', click: () => { void openWorkbench(); } },
      { type: 'separator' }, { label: '退出', click: () => app.quit() },
    ]));
    await wizardWindow.loadURL(wizardUrl);
    if (process.env.PW041_SMOKE === '1') {
      const { smokeDesktop } = await import('../../../integrations/prompt-wizard-041/smoke-desktop.mjs');
      await smokeDesktop({ wizardWindow, getWorkbenchWindow: () => workbenchWindow, workbench, wizardUrl });
      app.quit();
    }
  }).catch(error => { console.error('[pw041] 启动失败', error); app.exit(1); });
  app.on('window-all-closed', () => { if (!quitting) app.quit(); });
  app.on('before-quit', event => {
    quitting = true;
    if (shuttingDown) { if (!shutdownDone) event.preventDefault(); return; }
    shuttingDown = true; event.preventDefault();
    wizardWindow?.destroy(); workbenchWindow?.destroy();
    Promise.allSettled([workbench?.close(), closeWizard?.()]).finally(() => {
      tray?.destroy(); void globalThis.promptWizardGeminiWeb?.window?.close?.(); void globalThis.promptWizardChatGptWeb?.window?.close?.(); shutdownDone = true; app.quit();
    });
  });
}
