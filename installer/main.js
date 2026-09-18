// vulkan launcher Electron main process.
// Starts the Java backend, waits for it, then opens the native window.

'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, net, session, screen } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');
const { DiscordRpc } = require('./discord');

const PORT = 47820;
const API_URL = 'http://127.0.0.1:' + PORT + '/api/state';
const PROGRESS_URL = 'http://127.0.0.1:' + PORT + '/api/launch/progress';
const FRONTEND_VERSION = '20260914-2300';

// Application ID приложения Discord для лаунчера. Публичный ключ из настроек
// приложения для Rich Presence не нужен — Discord его не использует.
const DISCORD_APP_ID = '1548305497390850160';
let backend = null;
let win = null;
let splash = null;
let quitting = false;          // true once the user chose to close — suppresses auto-restart
let backendRestarts = 0;       // guard against restart storms
let portBusy = false;          // backend said "Address already in use"
let portRetries = 0;           // сколько раз ждали, пока система отпустит порт

// Keep smooth playback even when Minecraft steals window focus.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Locate Java on the host system.
//
// Ищем Java 21+ — её требует Minecraft 1.17 и новее. Но если такой нет, берём
// любую 17+: на 32-битной Windows 21-й версии не существует в принципе (ни у
// Adoptium, ни у Azul), а 17-я есть, и с ней идут версии игры до 1.20.1.
// Поэтому не «только 21», а «лучшая из найденных, но не ниже 17».
function findJava() {
  const cfg = readConfig();
  if (cfg && cfg.javaPath) {
    const jp = cfg.javaPath.replace(/\//g, '\\');
    if (fs.existsSync(jp)) return jp;
  }
  if (process.env.JAVA_HOME) {
    const p = path.join(process.env.JAVA_HOME, 'bin', 'javaw.exe');
    if (fs.existsSync(p)) return p;
  }
  const bases = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    'C:\\Program Files',
    'C:\\Program Files (x86)'
  ];
  const vendors = [
    'Eclipse Adoptium',
    'Java',
    'Microsoft',
    'Zulu',
    'Amazon Corretto',
    'BellSoft',
    'Semeru',
    'Oracle'
  ];

  // Разбираем версию из имени каталога: jdk-21.0.10 → 21, jdk1.8.0_402 → 8
  const versionOf = (dirName) => {
    const m = dirName.match(/(\d+)(?:\.(\d+))?/);
    if (!m) return 0;
    const major = Number(m[1]);
    return major === 1 ? Number(m[2] || 0) : major;
  };

  const found = [];
  for (const b of bases) {
    if (!b || !fs.existsSync(b)) continue;
    for (const v of vendors) {
      const dir = path.join(b, v);
      if (!fs.existsSync(dir)) continue;
      for (const jdk of fs.readdirSync(dir)) {
        const version = versionOf(jdk);
        if (version < 17) continue;
        for (const exe of ['javaw.exe', 'java.exe']) {
          const p = path.join(dir, jdk, 'bin', exe);
          if (fs.existsSync(p)) { found.push({ path: p, version }); break; }
        }
      }
    }
  }

  if (found.length) {
    found.sort((a, b) => b.version - a.version);
    const best = found.find((f) => f.version >= 21) || found[0];
    console.log('[vulkan] java:', best.path, '(версия', best.version + ')');
    return best.path;
  }
  return 'javaw';
}

// Read vulkan launcher config from APPDATA\pulsePLUS\config.json.
function readConfig() {
  try {
    const f = path.join(process.env.APPDATA || os.homedir(), 'pulsePLUS', 'config.json');
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (_) {}
  return null;
}

function dataDir() {
  return path.join(process.env.APPDATA || os.homedir(), 'pulsePLUS');
}

/*
 * Кнопка DIR открывает папку сборки, а не общую: у каждой версии с загрузчиком
 * она своя. Путь называет окно — вернее, бэкенд, который один знает правила
 * именования сборок (LauncherConfig.instanceName); здесь их повторять не надо.
 *
 * Но окно для оболочки — такая же недоверенная сторона, как страница в
 * браузере, и принимать от него любой путь нельзя: иначе кнопка стала бы
 * способом открыть в проводнике что угодно. Пускаем только внутрь папки
 * данных лаунчера; всё прочее молча уезжает в корень сборок.
 */
function safeFolder(wanted) {
  const data = path.resolve(dataDir());
  if (typeof wanted === 'string' && wanted.trim()) {
    const dir = path.resolve(wanted.trim());
    if (dir === data || dir.startsWith(data + path.sep)) return dir;
  }
  return path.join(data, 'instances');
}

// Backgrounds live in the launcher data dir so they can be replaced without touching
// the installation. The copy shipped in the app folder is seeded here on first run.
function videosDir() {
  return path.join(process.env.APPDATA || os.homedir(), 'pulsePLUS', 'videos');
}

function seedVideos() {
  try {
    const src = path.join(__dirname, 'backend', 'videos');
    if (!fs.existsSync(src)) return;
    const dst = videosDir();
    fs.mkdirSync(dst, { recursive: true });
    let copied = 0;
    for (const name of fs.readdirSync(src)) {
      const to = path.join(dst, name);
      if (fs.existsSync(to)) continue;      // never clobber a video the user put there
      try {
        fs.copyFileSync(path.join(src, name), to);
        copied++;
      } catch (_) {}
    }
    if (copied) console.log('[vulkan] seeded', copied, 'video(s) into', dst);
  } catch (_) {}
}

// The icon follows the mode: violet nebula for the client, green for Vanilla.
// Falls back to the plain icon when a theme file is missing.
function iconPath(mode) {
  const themed = path.join(__dirname, mode === 'vanilla' ? 'icon-vanilla.ico' : 'icon-vulkan.ico');
  if (fs.existsSync(themed)) return themed;
  const plain = path.join(__dirname, 'icon.ico');
  return fs.existsSync(plain) ? plain : undefined;
}

// Ярлык может открыть лаунчер сразу в нужном оформлении:
// `vulkan launcher.exe --mode=vanilla` даёт зелёную тему вместо фиолетовой.
function argMode() {
  const hit = process.argv.find(a => a.startsWith('--mode='));
  return hit && hit.slice('--mode='.length).toLowerCase() === 'vanilla' ? 'vanilla' : 'vulkan';
}

// Start the Java backend process.
function startBackend() {
  const jar = path.join(__dirname, 'backend', 'vulkan-launcher.jar');
  if (!fs.existsSync(jar)) {
    dialog.showErrorBox('vulkan launcher', 'Backend file not found:\n' + jar);
    app.quit();
    return;
  }
  const java = findJava();
  console.log('[vulkan] java:', java);
  console.log('[vulkan] jar: ', jar);
  try {
    backend = spawn(java, ['-jar', jar, '--server'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    // Drain the backend's stdio pipes so the OS pipe buffer never fills.
    // In a packaged windowless build process.stdout can be a broken handle, so the
    // writes are guarded — if we let them throw, the 'data' handler dies, the pipe
    // stops draining, and both the backend AND the launched game block on write().
    const backendLog = path.join(__dirname, 'backend', 'backend.log');
    let logStream = null;
    try { logStream = fs.createWriteStream(backendLog, { flags: 'a' }); } catch (_) {}
    const drain = (prefix, chunk) => {
      // Порт занят — Java падает с BindException ещё до открытия окна. Признак
      // запоминаем: сам по себе он ничего не решает (см. обработчик exit), но
      // без него мы бы приняли чужой бэкенд за свой.
      if (/BindException|Address already in use/.test(String(chunk))) portBusy = true;
      // Бэкенд поднялся — значит порт был наш, и прошлые осечки по порту больше
      // ничего не значат: счётчику ожидания незачем переезжать на новый случай.
      if (/Backend started/.test(String(chunk))) { portBusy = false; portRetries = 0; }
      try { if (logStream) logStream.write(chunk); } catch (_) {}
      try { process.stdout.write(prefix + chunk); } catch (_) {}
    };
    backend.stdout.on('data', d => drain('[java] ', d));
    backend.stderr.on('data', d => drain('[java] ', d));
    backend.on('error', e => {
      dialog.showErrorBox(
        'Java not found',
        'vulkan launcher requires Java 21.\nDownload: https://adoptium.net\n\n' + e.message
      );
    });
    backend.on('exit', code => {
      if (code !== null && code !== 0) {
        console.error('[vulkan] Backend exited with code', code);
      }

      // Порт занят. Значит, на 47820 уже отвечает ДРУГАЯ копия лаунчера — со
      // своими, возможно старыми, файлами. Открыть окно в этот момент значит
      // показать её интерфейс под своим именем и без единого слова об этом:
      // ровно так старый интерфейс выглядел как свежий баг.
      //
      // Но BindException бывает и от сокета в TIME_WAIT, когда на порту никто
      // не отвечает. Это различие и проверяем, прежде чем что-то утверждать.
      if (portBusy) {
        portBusy = false;
        probeServer((alive) => {
          if (alive) {
            if (splash && !splash.isDestroyed()) splash.close();
            dialog.showErrorBox(
              'vulkan launcher уже запущен',
              'На порту ' + PORT + ' уже отвечает другая копия лаунчера.\n\n' +
              'Закрой её и запусти заново: второй экземпляр показывал бы её окно, ' +
              'а не своё, и выглядело бы это как «ничего не изменилось».'
            );
            quitting = true;
            killBackend();
            app.exit(0);
            return;
          }
          // На порту никто не отвечает — сокет ещё не отпущен системой.
          // Это проходит само; ждём и пробуем снова, но не бесконечно.
          if (portRetries < 10 && !quitting) {
            portRetries++;
            console.warn('[vulkan] Порт ещё не отпущен, попытка #' + portRetries);
            setTimeout(startBackend, 500);
          } else {
            if (splash && !splash.isDestroyed()) splash.close();
            dialog.showErrorBox(
              'vulkan launcher',
              'Не удалось занять порт ' + PORT + '. Закрой другие копии лаунчера и попробуй снова.'
            );
            quitting = true;
            app.exit(0);
          }
        });
        return;
      }

      // Self-heal: if the backend dies while the launcher is still open (e.g. the
      // user killed the java process in Task Manager), respawn it and reload the UI
      // so the launcher never becomes a dead shell.
      if (!quitting && backendRestarts < 10) {
        backendRestarts++;
        console.warn('[vulkan] Backend died — restarting (#' + backendRestarts + ')');
        setTimeout(() => {
          startBackend();
          waitForServer(() => {
            if (win && !win.isDestroyed()) {
              win.reload();
            }
          });
        }, 800);
      }
    });
  } catch (e) {
    dialog.showErrorBox('Startup error', String(e));
  }
}

// Small frameless "welcome" splash shown instantly while the backend boots.
function createSplash() {
  try {
    splash = new BrowserWindow({
      width: 440,
      height: 300,
      frame: false,
      transparent: true,
      resizable: false,
      center: true,
      show: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      backgroundColor: '#00000000',
      webPreferences: { contextIsolation: true, nodeIntegration: false }
    });
    splash.loadFile(path.join(__dirname, 'welcome.html'), { query: { mode: argMode() } });
    splash.once('ready-to-show', () => splash && splash.show());
  } catch (_) { splash = null; }
}

function closeSplash() {
  if (splash && !splash.isDestroyed()) {
    try { splash.close(); } catch (_) {}
  }
  splash = null;
}

// Wait for the backend HTTP server.
function waitForServer(cb, tries = 0) {
  http.get(API_URL, res => {
    res.resume();
    cb();
  }).on('error', () => {
    if (tries < 100) setTimeout(() => waitForServer(cb, tries + 1), 300);
    else {
      console.warn('[vulkan] Backend timeout, opening anyway');
      cb();
    }
  });
}

/**
 * Отвечает ли кто-нибудь на нашем порту.
 *
 * Нужен, чтобы отличить «лаунчер уже запущен» от «сокет ещё не отпущен»: и то
 * и другое даёт BindException, но означают они разное. Живой ответ — это чужая
 * копия; молчание — сокет в TIME_WAIT, который пройдёт сам.
 */
function probeServer(cb, timeoutMs) {
  let done = false;
  const finish = (alive) => { if (!done) { done = true; cb(alive); } };
  let req;
  try {
    req = http.get(API_URL, (res) => { res.resume(); finish(true); });
  } catch (_) {
    finish(false);
    return;
  }
  req.on('error', () => finish(false));
  req.setTimeout(timeoutMs || 700, () => {
    try { req.destroy(); } catch (_) {}
    finish(false);
  });
}

// ── Discord Rich Presence ───────────────────────────────────────────────────
//
// Бэкенд уже публикует стадию запуска в /api/launch/progress, поэтому статус
// строим по ней, а не по догадкам. Discord может быть не запущен — это обычная
// ситуация, клиент сам молча ждёт и переподключается.

let rpc = null;
let presenceTimer = null;
let gameLabel = 'Minecraft';
let lastPresence = '';
const appStartedAt = Date.now();

function fetchJson(url, cb) {
  http.get(url, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => {
      try { cb(JSON.parse(body)); } catch (_) { cb(null); }
    });
  }).on('error', () => cb(null));
}

function applyPresence(progress) {
  if (!rpc || !rpc.enabled) return;
  const stage = (progress && progress.stage) || 'idle';
  let activity;

  if (stage === 'preparing') {
    activity = {
      details: 'Запускает Minecraft',
      state: (progress && progress.message) || 'Подготовка',
      timestamps: { start: Date.now() },
      assets: { large_image: 'vulkan', large_text: 'vulkan launcher' }
    };
  } else if (stage === 'running') {
    activity = {
      details: 'Играет в Minecraft',
      state: gameLabel,
      timestamps: { start: Date.now() },
      assets: { large_image: 'vulkan', large_text: 'vulkan launcher' }
    };
  } else if (stage === 'error') {
    activity = {
      details: 'Ошибка запуска',
      state: (progress && progress.message) || 'не удалось запустить',
      timestamps: { start: appStartedAt },
      assets: { large_image: 'vulkan', large_text: 'vulkan launcher' }
    };
  } else {
    activity = {
      details: 'В лаунчере',
      state: 'выбирает сборку',
      timestamps: { start: appStartedAt },
      assets: { large_image: 'vulkan', large_text: 'vulkan launcher' }
    };
  }

  // Discord не любит лишние обновления — шлём только при смене статуса
  const key = JSON.stringify(activity);
  if (key === lastPresence) return;
  lastPresence = key;
  rpc.setActivity(activity);
}

function startDiscord() {
  const cfg = readConfig();
  const appId = (cfg && cfg.discordLauncherAppId) || DISCORD_APP_ID;
  rpc = new DiscordRpc(appId, (msg) => console.log(msg));
  if (!rpc.enabled) return;
  rpc.start();

  // Название сборки берём один раз: оно меняется только через настройки
  fetchJson(API_URL, (state) => {
    if (state) {
      const version = state.vanillaVersion || state.selectedVersion || '1.21.4';
      const mode = state.lastMode === 'vanilla' ? 'Vanilla' : 'vulkan';
      gameLabel = `Minecraft ${version} · ${mode}`;
    }
  });

  presenceTimer = setInterval(() => {
    fetchJson(PROGRESS_URL, (progress) => applyPresence(progress));
  }, 4000);
  fetchJson(PROGRESS_URL, (progress) => applyPresence(progress));
}

function stopDiscord() {
  clearInterval(presenceTimer);
  presenceTimer = null;
  if (rpc) rpc.stop();
  rpc = null;
  lastPresence = '';
}

// Размер и место окна помним между запусками.
//
// Развёрнутым не открываем НИКОГДА, даже если игрок закрыл окно развёрнутым:
// вёрстка рассчитана на ширину около 1100 и в развороте расползается. Правило
// старше этой памятки и здесь только подтверждается.
const WINDOW_STATE = () => path.join(app.getPath('userData'), 'window.json');

function loadWindowState() {
  let s;
  try {
    s = JSON.parse(fs.readFileSync(WINDOW_STATE(), 'utf8'));
  } catch (_) {
    return null;              // файла нет или он битый — откроемся по центру
  }
  if (!s || !Number.isFinite(s.width) || !Number.isFinite(s.height)) return null;

  // Место проверяем: монитор могли отключить или сменить разрешение, и тогда
  // окно оказалось бы за пределами рабочего стола — то есть просто пропало бы.
  // Размер при этом сохраняем: он осмыслен и сам по себе.
  if (Number.isFinite(s.x) && Number.isFinite(s.y)) {
    const onScreen = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return s.x + s.width > a.x && s.x < a.x + a.width
          && s.y + s.height > a.y && s.y < a.y + a.height;
    });
    if (!onScreen) { delete s.x; delete s.y; }
  }
  return s;
}

function saveWindowState() {
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  try {
    // У развёрнутого окна берём НОРМАЛЬНЫЕ размеры: getBounds() вернул бы
    // размеры экрана, и следующий запуск открылся бы во весь монитор.
    const b = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
    fs.writeFileSync(WINDOW_STATE(), JSON.stringify(b));
  } catch (_) {
    // не сохранилось — не беда, откроемся по центру
  }
}

// Create the launcher window.
async function createWindow() {
  const st = loadWindowState();
  win = new BrowserWindow({
    // Comfortable fixed default so the interface never opens cramped/maximized
    width: st ? st.width : 1100,
    height: st ? st.height : 700,
    x: st && st.x,
    y: st && st.y,
    center: !st || st.x === undefined,
    minWidth: 940,
    minHeight: 600,
    frame: false,
    show: false,
    backgroundColor: '#0B0B0F',
    show: false,
    icon: iconPath(argMode()),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
      webSecurity: false
    }
  });

  try {
    await win.webContents.session.clearCache();
    await win.webContents.session.clearStorageData({
      storages: ['serviceworkers', 'cachestorage']
    });
  } catch (_) {}

  win.loadURL('http://127.0.0.1:' + PORT + '/?v=' + FRONTEND_VERSION + '&mode=' + argMode());

  win.once('ready-to-show', () => {
    // Never open maximized — a maximized window squeezes the fixed-layout UI
    if (win.isMaximized()) win.unmaximize();
    win.show();
    win.focus();
    // Hand off from the welcome splash to the real window
    setTimeout(closeSplash, 180);
  });

  // Open DevTools only on Alt+F12.
  win.webContents.on('before-input-event', (_, input) => {
    if (input.alt && input.key === 'F12') win.webContents.openDevTools();
  });

  win.on('closed', () => {
    win = null;
  });

  // Фокус сообщаем странице сами: рендерер о потере фокуса может не узнать.
  // Замер на живой машине показал, что document.hasFocus() остаётся true, даже
  // когда активное окно принадлежит другой программе, — на этом и повисла
  // пауза фоновых роликов. Активация окна на стороне Electron — это то же
  // самое событие, но полученное от Windows, а не от догадок страницы.
  const reportFocus = () => {
    if (win && !win.isDestroyed()) win.webContents.send('win-focus', win.isFocused());
  };
  win.on('focus', reportFocus);
  win.on('blur', reportFocus);
  // Страница спрашивает состояние сама: событие к моменту её загрузки уже прошло,
  // и, ожидая только событий, она начала бы с неверного «в фокусе».
  ipcMain.handle('win-focus-state', () => !!win && !win.isDestroyed() && win.isFocused());

  // Пишем не на каждое движение, а спустя паузу: при перетаскивании окна
  // события идут десятками в секунду, и диск бы захлебнулся.
  let saveTimer = null;
  const queueSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveWindowState, 500);
  };
  win.on('resize', queueSave);
  win.on('move', queueSave);
  win.on('close', () => {
    clearTimeout(saveTimer);
    saveWindowState();
  });
}

// IPC for titlebar buttons.
ipcMain.on('win-min', () => win && win.minimize());
ipcMain.on('win-max', () => {
  if (!win) return;
  win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.on('win-close', () => {
  quitting = true;              // suppress backend auto-restart
  stopDiscord();
  killBackend();
  app.quit();
});
ipcMain.on('open-folder', (_, wanted) => {
  const d = safeFolder(wanted);
  try { fs.mkdirSync(d, { recursive: true }); } catch (_) {}
  shell.openPath(d);
});
ipcMain.on('open-external', (_, url) => {
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    shell.openExternal(url);
  }
});

// Change the window title when the user switches profiles
ipcMain.on('set-title', (_, title) => {
  if (win && typeof title === 'string') win.setTitle(title);
});

// Swap the window / taskbar icon when the mode changes
ipcMain.on('set-mode', (_, mode) => {
  if (win && !win.isDestroyed()) {
    const icon = iconPath(mode);
    if (icon) win.setIcon(icon);
  }
});

// Launch via Node http — bypasses browser fetch restrictions
ipcMain.handle('launch-minecraft', (_, params) => {
  return new Promise((resolve) => {
    const postData = JSON.stringify(params);
    const req = http.request({
      hostname: '127.0.0.1', port: PORT,
      path: '/api/launch', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { resolve({ ok: true }); }
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(postData);
    req.end();
  });
});

let spotifyWin = null;
ipcMain.on('open-spotify-player', (_, url) => {
  if (typeof url !== 'string' || !url.startsWith('https://')) return;
  if (spotifyWin && !spotifyWin.isDestroyed()) {
    spotifyWin.loadURL(url);
    spotifyWin.show();
    spotifyWin.focus();
    return;
  }
  spotifyWin = new BrowserWindow({
    width: 420,
    height: 720,
    minWidth: 380,
    minHeight: 500,
    title: 'Spotify — vulkan',
    backgroundColor: '#121212',
    webPreferences: {
      partition: 'persist:spotify',
      contextIsolation: true,
      nodeIntegration: false,
      // Real Chrome UA so Spotify doesn't block playback
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    }
  });
  spotifyWin.loadURL(url);
  spotifyWin.on('closed', () => { spotifyWin = null; });
});

let elybyWin = null;
// Окно ely.by: регистрация, вход и загрузка скина.
//
// Своя сессия (partition) — как у Spotify: она переживает перезапуск лаунчера,
// поэтому входить нужно один раз. Обычный Chrome UA обязателен: ely.by стоит за
// Cloudflare, а тот встречает UA Electron проверкой.
//
// OAuth тут нет намеренно. Скин лаунчер тянет по нику через SkinService, и
// никакого ключа для этого не нужно. Вход через ely.by в сам лаунчер — другая
// задача: он потребовал бы client_id приложения, заведённого на их сайте руками.
ipcMain.on('open-elyby', (_, page) => {
  // Наружу отсюда уходит не URL, а ключ страницы: адрес, пришедший из окна,
  // — это открытая дверь в произвольную навигацию.
  //
  // Вход ведёт на /authorization/login, а не на account.ely.by: сайт пускает
  // через OAuth2 (client_id «ely»), и только этот круг выдаёт cookie identity
  // на домене ely.by — ту самую, которой потом надевается скин. Прямой вход в
  // account.ely.by сессию сайта не даёт: с ней /skins/wear отвечает error_login.
  const url = page === 'login'
    ? 'https://ely.by/authorization/login'
    : 'https://account.ely.by/register';
  if (elybyWin && !elybyWin.isDestroyed()) {
    elybyWin.loadURL(url);
    elybyWin.show();
    elybyWin.focus();
    return;
  }
  elybyWin = new BrowserWindow({
    width: 520,
    height: 760,
    minWidth: 420,
    minHeight: 520,
    title: 'ely.by — vulkan',
    backgroundColor: '#12141c',
    webPreferences: {
      partition: 'persist:elyby',
      contextIsolation: true,
      nodeIntegration: false,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    }
  });
  elybyWin.loadURL(url);
  elybyWin.on('closed', () => {
    elybyWin = null;
    // Скин могли только что загрузить на сайте, а у нас он лежит в кэше до
    // суток. Закрытие окна — единственный момент, когда уместно его сбросить.
    if (win && !win.isDestroyed()) win.webContents.send('elyby-closed');
  });
});

// ── ely.by: кто вошёл и надеть скин ─────────────────────────────────────────
//
// Сессия ely.by лежит в партиции persist:elyby — то есть внутри Chromium, а не
// в Java. Поэтому оба действия делает окно, а не бэкенд. Так выходит не только
// проще, но и безопаснее: net.request с этой партицией цепляет cookie identity
// САМА (проверено живьём), и значение cookie вообще не приходится доставать из
// хранилища. Секрет не проходит ни через IPC, ни через лог.
//
// Контракты разведаны на живом сайте:
//
//   GET  https://ely.by/           -> {"content":..., "title":...}
//        у вошедшего в content есть <span id="sidebarUserName">ник</span>,
//        у гостя — ссылка /authorization/login. Признак взят из разметки, а не
//        из title: title локализован и следует языку аккаунта («Профиль» /
//        «Profile»), так что опираться на него нельзя.
//
//   POST https://ely.by/skins/wear -> тело skinId=<id>
//        Отказ приходит КОДОМ 200 с телом {"error":"error_login"}, а не 401.
//        Поэтому смотрим тело, а не статус: по статусу отказ выглядел бы удачей.
//
//        УДАЧА ТОЖЕ ЛЕЖИТ В ПОЛЕ error: {"text":"","error":"success_skin_change"}.
//        Проверено живьём на своём аккаунте. Пока мы считали отказом любую
//        непустую error, выходило хуже, чем ошибка в тосте: «Надеть» не доводило
//        дело до перечитывания скина, и лаунчер до суток показывал прежний. Их
//        собственный клиент разбирает это так же — error.includes('success').

const ELYBY_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
               + '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function elybyRequest(url, opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    let req;
    try {
      req = net.request({
        url,
        session: session.fromPartition('persist:elyby'),
        method: o.method || 'GET',
        useSessionCookies: true
      });
    } catch (e) {
      resolve({ status: 0, body: '' });
      return;
    }
    req.setHeader('User-Agent', ELYBY_UA);
    req.setHeader('X-Requested-With', 'XMLHttpRequest');
    req.setHeader('Accept', 'application/json, text/html');
    if (o.body) req.setHeader('Content-Type', 'application/x-www-form-urlencoded');

    let body = '';
    req.on('response', (res) => {
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    if (o.body) req.write(o.body);
    req.end();
  });
}

/**
 * Ник вошедшего, либо пустая строка.
 *
 * Ответ на https://ely.by/ приходит НЕ разметкой, а JSON-конвертом
 * {"content":"<div …>","title":"…"}, и кавычки внутри content экранированы
 * обратным слешем. Пока мы искали `id="sidebarUserName"` в сыром теле, шаблон
 * не совпадал НИКОГДА: в теле лежит `id=\"sidebarUserName\"`. Снаружи это
 * выглядело так, будто игрок не вошёл, — «Надеть» отказывал ещё до запроса, а
 * ник не показывался нигде. Поэтому сперва разбираем конверт, а уж потом ищем
 * разметку; если конверта нет, работаем с телом как есть (обычный HTML).
 */
function elybyHtml(body) {
  const raw = body || '';
  if (!raw.trimStart().startsWith('{')) return raw;
  try {
    const j = JSON.parse(raw);
    if (j && typeof j.content === 'string') return j.content;
  } catch (_) { /* не JSON — значит разметка, идём дальше по сырому телу */ }
  return raw;
}

function elybyNickFrom(body) {
  const html = elybyHtml(body);
  const m = /id="sidebarUserName"[^>]*>([\s\S]*?)</.exec(html);
  if (!m) return '';
  const nick = m[1].trim();
  // Ник ely.by — только латиница, цифры и подчёркивание. Проверяем и здесь:
  // строка уходит в интерфейс, и мусор из разметки там ни к чему.
  return /^[A-Za-z0-9_]{1,16}$/.test(nick) ? nick : '';
}

ipcMain.handle('elyby-state', async () => {
  const r = await elybyRequest('https://ely.by/');
  if (r.status !== 200) return { loggedIn: false, nick: '', offline: true };
  const nick = elybyNickFrom(r.body);
  return { loggedIn: !!nick, nick };
});

/**
 * Выход: чистим партицию, а не дёргаем их страницу выхода.
 *
 * Адреса выхода в разметке нет — он живёт в общем макете сайта, а нам приходит
 * только содержимое страницы. Угадывать URL и получать «страница не найдена»
 * хуже, чем сделать ровно то, что означает выход здесь: стереть сессию окна.
 * Окно ely.by живёт в этой же партиции, так что выход виден и ему.
 */
ipcMain.handle('elyby-logout', async () => {
  try {
    const s = session.fromPartition('persist:elyby');
    await s.clearStorageData();
    await s.flushStorageData();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message) };
  }
});

ipcMain.handle('elyby-wear', async (_, skinId) => {
  // Наружу уходит только число: идентификатор приходит из окна, а окно для
  // оболочки — такая же недоверенная сторона, как страница в браузере.
  const id = String(skinId == null ? '' : skinId).replace(/[^0-9]/g, '');
  if (!id || id.length > 12) return { ok: false, error: 'error_id' };

  const r = await elybyRequest('https://ely.by/skins/wear', {
    method: 'POST',
    body: 'skinId=' + id
  });
  if (r.status === 0) return { ok: false, error: 'error_network' };

  let parsed = null;
  try { parsed = JSON.parse(r.body); } catch (_) {}
  // Поле error несёт ИСХОД, а не только беду: удача — это "success_skin_change".
  // Поэтому «есть error» не значит «отказ» — иначе каждое удачное надевание
  // возвращалось бы как ошибка. Проверяем не пустоту, а слово.
  if (parsed && typeof parsed.error === 'string' && parsed.error) {
    if (parsed.error.includes('success')) return { ok: true };
    return { ok: false, error: parsed.error };
  }
  if (r.status !== 200) return { ok: false, error: 'error_' + r.status };
  return { ok: true };
});

function killBackend() {
  try {
    if (backend && !backend.killed) backend.kill();
  } catch (_) {}
}

app.whenReady().then(() => {
  createSplash();               // instant welcome while the backend boots
  seedVideos();                 // lay backgrounds into %APPDATA%\pulsePLUS\videos

  // Прежде чем поднимать свой бэкенд — проверяем, не отвечает ли на порту чужая
  // копия лаунчера. Проверка ДО запуска, а не после: иначе окно успевает
  // открыться и показать интерфейс той копии, а её файлы могут быть старыми.
  // Именно так «пнг вместо 3д» выглядело на сборке, где 3D был: окно грузило
  // 47820, а отвечал на нём бэкенд прошлой копии.
  probeServer((alive) => {
    if (alive) {
      if (splash && !splash.isDestroyed()) splash.close();
      console.warn('[vulkan] Порт ' + PORT + ' занят другой копией — выходим, окно не открываем');
      dialog.showErrorBox(
        'vulkan launcher уже запущен',
        'На порту ' + PORT + ' уже отвечает другая копия лаунчера.\n\n' +
        'Закрой её и запусти заново: второй экземпляр показывал бы её окно, ' +
        'а не своё, и выглядело бы это как «ничего не изменилось».'
      );
      quitting = true;
      killBackend();
      app.exit(0);
      return;
    }
    startBackend();
    startDiscord();
    waitForServer(createWindow);
  });
});

app.on('window-all-closed', () => {
  quitting = true;
  killBackend();
  app.quit();
});
app.on('before-quit', () => { quitting = true; stopDiscord(); killBackend(); });
app.on('activate', () => {
  if (win === null) waitForServer(createWindow);
});
