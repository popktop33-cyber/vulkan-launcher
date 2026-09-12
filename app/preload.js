// Exposes safe window/file controls to the page (contextIsolation on).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pulse', {
  minimize:          () => ipcRenderer.send('win-min'),
  maximize:          () => ipcRenderer.send('win-max'),
  close:             () => ipcRenderer.send('win-close'),
  openFolder:        () => ipcRenderer.send('open-folder'),
  openFolderVanilla: () => ipcRenderer.send('open-folder-vanilla'),
  openExternal:      (url)   => ipcRenderer.send('open-external', url),
  openSpotifyPlayer: (url)   => ipcRenderer.send('open-spotify-player', url),
  setTitle:          (title) => ipcRenderer.send('set-title', title),
  setMode:           (mode)  => ipcRenderer.send('set-mode', mode),
  launchMinecraft:   (params) => ipcRenderer.invoke('launch-minecraft', params)
});
