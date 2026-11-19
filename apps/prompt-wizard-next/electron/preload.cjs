const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pwShell', {
  setMode: mode => ipcRenderer.invoke('shell:mode', mode),
  setAlwaysOnTop: value => ipcRenderer.invoke('shell:on-top', Boolean(value)),
  getState: () => ipcRenderer.invoke('shell:state'),
  openWorkbench: () => ipcRenderer.invoke('shell:open-workbench'),
})
