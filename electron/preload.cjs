const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("musikkuDesktop", {
  importAudio: (mode) => ipcRenderer.invoke("musikku:import-audio", mode),
  importLyrics: () => ipcRenderer.invoke("musikku:import-lyrics"),
  exportBackup: (payload) => ipcRenderer.invoke("musikku:export-backup", payload),
  restoreBackup: (filePath) => ipcRenderer.invoke("musikku:restore-backup", filePath),
  getUpdateState: () => ipcRenderer.invoke("musikku:update-state"),
  checkForUpdates: () => ipcRenderer.invoke("musikku:check-updates"),
  downloadUpdate: () => ipcRenderer.invoke("musikku:download-update"),
  installUpdate: () => ipcRenderer.invoke("musikku:install-update"),
  onImportProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("musikku:import-progress", listener);
    return () => ipcRenderer.removeListener("musikku:import-progress", listener);
  },
  onUpdateState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("musikku:update-state", listener);
    return () => ipcRenderer.removeListener("musikku:update-state", listener);
  },
});
