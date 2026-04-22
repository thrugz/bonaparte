const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bonaparte", {
  getVersion: () => ipcRenderer.invoke("bonaparte:version"),
  runUpdate: () => ipcRenderer.invoke("bonaparte:run-update"),
});
