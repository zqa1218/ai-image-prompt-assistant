// 注意：sandbox 模式下 Electron 只接受 CommonJS preload。
// 之前写成 .mjs 会被静默忽略（不报错），导致 window.pwShell 不存在、
// 收窄只改布局不缩窗口。这里用 require + .cjs。
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pwShell', {
  setMode: (mode) => ipcRenderer.invoke('shell:mode', mode),
  setAlwaysOnTop: (value) => ipcRenderer.invoke('shell:on-top', Boolean(value)),
  getState: () => ipcRenderer.invoke('shell:state'),
  listCompanions: () => ipcRenderer.invoke('companion:list'),
  getCompanion: () => ipcRenderer.invoke('companion:state'),
  setCompanion: (selection) => ipcRenderer.invoke('companion:set', selection),
  handoff: () => ipcRenderer.invoke('companion:handoff'),
  onCompanion: (callback) => {
    const handler = (_event, state) => callback(state)
    ipcRenderer.on('companion:state', handler)
    return () => ipcRenderer.removeListener('companion:state', handler)
  },
})
