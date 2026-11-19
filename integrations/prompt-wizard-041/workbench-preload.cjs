const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pwWorkbench', {
  openMj: () => ipcRenderer.invoke('mj:open'),
  generateMj: (taskId, revision) => ipcRenderer.invoke('mj:generate', taskId, revision),
  collectMj: (taskId, runId) => ipcRenderer.invoke('mj:collect', taskId, runId),
  getMjSettings: () => ipcRenderer.invoke('mj:settings'),
  setMjAutoSubmit: enabled => ipcRenderer.invoke('mj:set-auto-submit', enabled === true),
  pendingMj: (taskId, revision) => ipcRenderer.invoke('mj:pending', taskId, revision),
  clearPendingMj: (taskId, revision) => ipcRenderer.invoke('mj:clear-pending', taskId, revision),
  showWizard: () => ipcRenderer.invoke('workbench:show-wizard') });
