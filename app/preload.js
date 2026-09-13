// Exposes safe window/file controls to the page (contextIsolation on).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pulse', {
  minimize:          () => ipcRenderer.send('win-min'),
  maximize:          () => ipcRenderer.send('win-max'),
  close:             () => ipcRenderer.send('win-close'),
  // dir — путь к папке сборки; его называет бэкенд (/api/instance-dir).
  // Без аргумента откроется корень сборок. Путь вне папки данных отсекается.
  openFolder:        (dir)   => ipcRenderer.send('open-folder', dir),
  openExternal:      (url)   => ipcRenderer.send('open-external', url),
  openSpotifyPlayer: (url)   => ipcRenderer.send('open-spotify-player', url),
  setTitle:          (title) => ipcRenderer.send('set-title', title),
  setMode:           (mode)  => ipcRenderer.send('set-mode', mode),
  launchMinecraft:   (params) => ipcRenderer.invoke('launch-minecraft', params)
});
