const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pwShell', {
  setMode: mode => ipcRenderer.invoke('shell:mode', mode),
  setAlwaysOnTop: value => ipcRenderer.invoke('shell:on-top', Boolean(value)),
  getState: () => ipcRenderer.invoke('shell:state'),
  listCompanions: () => ipcRenderer.invoke('companion:list'),
  getCompanion: () => ipcRenderer.invoke('companion:state'),
  setCompanion: selection => ipcRenderer.invoke('companion:set', selection),
  handoff: () => ipcRenderer.invoke('companion:handoff'),
  pickPoseDir: () => ipcRenderer.invoke('pose:pick-dir'),
  revealDir: dir => ipcRenderer.invoke('pose:reveal-dir', dir),
  openWorkbench: () => ipcRenderer.invoke('workbench:open'),
  importWorkbench: request => ipcRenderer.invoke('workbench:import', request),
  onCompanion: callback => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('companion:state', handler);
    return () => ipcRenderer.removeListener('companion:state', handler);
  },
});
