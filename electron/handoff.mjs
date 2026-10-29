// 「复制并切到耀 AI」的窗口通道。
//
// 跟随（自动隐藏/停靠）已移除：它需要常驻窗口监听进程，
// 实测中还会把助手自己藏起来，体验得不偿失。
// 这里只保留两个动作：列出可交接的窗口、把其中一个带到前台。
import path from 'node:path'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function attachHandoff({ app, ipcMain, psPath }) {
  // 打包后 app.getAppPath() 指向 app.asar；.ps1 在 asar 里 PowerShell 读不了。
  // electron-builder 已把它标为 unpacked，这里要显式换成 app.asar.unpacked 的路径。
  const appPath = app.getAppPath()
  const root = appPath.endsWith('app.asar')
    ? appPath.replace(/app\.asar$/, 'app.asar.unpacked')
    : appPath
  const packaged = path.join(root, 'electron', 'window-link.ps1')
  const clickScript = path.join(path.dirname(packaged), 'click-orb.ps1')
  const ps = psPath ?? (existsSync(packaged) ? packaged : path.join(appPath, 'electron', 'window-link.ps1'))
  const args = (mode, target) =>
    ['-NoProfile', '-NonInteractive', '-STA', '-File', ps, '-Mode', mode, ...(target ? ['-Handle', target.handle, '-TargetPid', String(target.pid)] : [])]

  const list = async () => {
    const { stdout } = await run('powershell.exe', args('list'), { windowsHide: true, timeout: 15000, maxBuffer: 256 * 1024 })
    return JSON.parse(stdout.trim() || '[]')
  }

  ipcMain.handle('companion:list', list)

  // 前端仍可能查状态：跟随没了，固定返回未启用
  ipcMain.handle('companion:state', () => ({ target: null, paused: false, side: 'right', notice: '' }))

  // 跟随入口已移除，调用即告知不支持
  ipcMain.handle('companion:set', () => ({ target: null, paused: false, side: 'right', notice: '跟随功能已移除' }))

  ipcMain.handle('companion:handoff', async () => {
    const windows = (await list()).filter((item) => item.kind === 'yao')
    // 耀 AI 会同时有「悬浮球（96×96）」「收藏面板」「主功能区」多个窗口。
    // 切到球上等于没唤醒，所以优先选面积最大的那个——那才是主功能区。
    const byArea = [...windows].sort((a, b) => (b.w ?? 0) * (b.h ?? 0) - (a.w ?? 0) * (a.h ?? 0))
    const main = byArea[0]
    if (main) {
      try {
        await run('powershell.exe', args('activate', main), { windowsHide: true, timeout: 15000 })
        // 耀 AI 的主面板和小球互斥：ShowWindow 叫醒后它会紧接着自己再藏回去，
        // 所以要等一下再复查；仍然藏着就点小球——那是它自己的展开入口。
        await delay(700)
        let mainNow = (await list()).find((item) => item.handle === main.handle)
        if (mainNow && !mainNow.visible) {
          // 主面板收起时，耀 AI 的展开入口是「双击小球」（单击只是选中）。
          const orb = windows.find((item) => item.title.includes('Orb') && item.visible)
          if (orb && existsSync(clickScript)) {
            await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', clickScript, '-Handle', orb.handle], { windowsHide: true, timeout: 15000 })
            await delay(1200)
            mainNow = (await list()).find((item) => item.handle === main.handle)
            return {
              message: mainNow?.visible
                ? '已复制并展开耀 AI，请粘贴后提交。'
                : '已复制；耀 AI 主面板没展开，请双击小球后粘贴。',
            }
          }
          return { message: '已复制；耀 AI 主面板当前是收起的，双击小球展开后粘贴。' }
        }
        return { message: '已复制并切到耀 AI，请粘贴后提交。' }
      } catch {
        return { message: '已复制；切换窗口失败，请手动打开耀 AI 粘贴。' }
      }
    }
    const exe = path.join(app.getPath('home'), 'AppData/Local/Yao-AI/yaoai_desktop.exe')
    if (!existsSync(exe)) return { message: '已复制；未找到耀 AI，请手动打开后粘贴。' }
    const child = spawn(exe, [], { detached: true, windowsHide: true, stdio: 'ignore' })
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
    child.unref()
    return { message: '已复制并启动耀 AI，请在窗口就绪后粘贴。' }
  })
}
