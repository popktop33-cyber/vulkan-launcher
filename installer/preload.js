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
  // page — ключ страницы ('register' или 'login'), не адрес: окно само решает,
  // куда идти. Событие приходит, когда окно ely.by закрыли: скин на сайте могли
  // только что поменять, а у нас он в кэше до суток.
  openElyBy:         (page)  => ipcRenderer.send('open-elyby', page),
  onElyByClosed:     (cb)    => ipcRenderer.on('elyby-closed', () => cb()),
  // Кто вошёл на ely.by и надевание скина. Делает окно, а не Java: сессия
  // сайта живёт в партиции Chromium, и cookie оттуда никуда не выносится.
  elybyState:        ()      => ipcRenderer.invoke('elyby-state'),
  elybyWear:         (skinId) => ipcRenderer.invoke('elyby-wear', skinId),
  elybyLogout:       ()      => ipcRenderer.invoke('elyby-logout'),
  setTitle:          (title) => ipcRenderer.send('set-title', title),
  setMode:           (mode)  => ipcRenderer.send('set-mode', mode),
  launchMinecraft:   (params) => ipcRenderer.invoke('launch-minecraft', params),
  // Фокус окна. Событие рендерера о потере фокуса срабатывает не всегда — на
  // живой игре document.hasFocus() оставался true, когда лаунчер уже ушёл под
  // окно игры, и фоновые ролики продолжали декодироваться вхолостую.
  // Здесь то же состояние, но взятое у Windows главным процессом.
  focusState:        ()      => ipcRenderer.invoke('win-focus-state'),
  onFocusChange:     (cb)    => ipcRenderer.on('win-focus', (_, focused) => cb(!!focused))
});
