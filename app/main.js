// vulkan launcher Electron main process.
// Starts the Java backend, waits for it, then opens the native window.

'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');

const PORT = 47820;
const API_URL = 'http://127.0.0.1:' + PORT + '/api/state';
const FRONTEND_VERSION = '20260706-0004';
let backend = null;
let win = null;
let splash = null;
let quitting = false;          // true once the user chose to close — suppresses auto-restart
let backendRestarts = 0;       // guard against restart storms

// Keep smooth playback even when Minecraft steals window focus.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Locate Java 21 on the host system.
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
  for (const b of bases) {
    if (!b || !fs.existsSync(b)) continue;
    for (const v of vendors) {
      const dir = path.join(b, v);
      if (!fs.existsSync(dir)) continue;
      for (const jdk of fs.readdirSync(dir)) {
        if (!jdk.includes('21') && !jdk.includes('22') && !jdk.includes('23')) continue;
        for (const exe of ['javaw.exe', 'java.exe']) {
          const p = path.join(dir, jdk, 'bin', exe);
          if (fs.existsSync(p)) return p;
        }
      }
    }
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

function gameDir() {
  return path.join(process.env.APPDATA || os.homedir(), 'pulsePLUS', 'minecraft');
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

// A shortcut can open straight into a mode: `vulkan launcher.exe --mode=vanilla`
function argMode() {
  const hit = process.argv.find(a => a.startsWith('--mode='));
  return hit && hit.slice('--mode='.length).toLowerCase() === 'vanilla' ? 'vanilla' : 'pulse';
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

// Create the launcher window.
async function createWindow() {
  win = new BrowserWindow({
    // Comfortable fixed default so the interface never opens cramped/maximized
    width: 1100,
    height: 700,
    minWidth: 940,
    minHeight: 600,
    frame: false,
    center: true,
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
}

// IPC for titlebar buttons.
ipcMain.on('win-min', () => win && win.minimize());
ipcMain.on('win-max', () => {
  if (!win) return;
  win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.on('win-close', () => {
  quitting = true;              // suppress backend auto-restart
  killBackend();
  app.quit();
});
ipcMain.on('open-folder', () => {
  const d = gameDir();
  fs.mkdirSync(d, { recursive: true });
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

// Open the vulkan or vanilla game folder
ipcMain.on('open-folder-vanilla', () => {
  const d = path.join(process.env.APPDATA || os.homedir(), 'pulsePLUS', 'vanilla');
  fs.mkdirSync(d, { recursive: true });
  shell.openPath(d);
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

function killBackend() {
  try {
    if (backend && !backend.killed) backend.kill();
  } catch (_) {}
}

app.whenReady().then(() => {
  createSplash();               // instant welcome while the backend boots
  seedVideos();                 // lay backgrounds into %APPDATA%\pulsePLUS\videos
  startBackend();
  waitForServer(createWindow);
});

app.on('window-all-closed', () => {
  quitting = true;
  killBackend();
  app.quit();
});
app.on('before-quit', () => { quitting = true; killBackend(); });
app.on('activate', () => {
  if (win === null) waitForServer(createWindow);
});
