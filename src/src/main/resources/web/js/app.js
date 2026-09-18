'use strict';

const API = 'http://127.0.0.1:47820';
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const IS_FILE_PREVIEW = location.protocol === 'file:';

// Откуда берутся фоновые ролики. Через бэкенд — с корня сайта. Когда интерфейс
// открыт файлом (режим показа: ничего не качается, всё на заглушках), рядом с
// index.html кладётся папка videos, и путь должен быть относительным — иначе
// браузер искал бы их в корне диска.
const VIDEO_BASE = IS_FILE_PREVIEW ? 'videos/' : '/videos/';

// ── Launcher display name ─────────────────────────────────────────────────────
// Fixed brand name (no longer randomised). Change this one line to rebrand.
const LAUNCHER_NAME = 'vulkan';

const LOADER_FAMILY_LABELS = {
  vanilla: 'Vanilla',
  fabric: 'Fabric',
  forge: 'Forge',
  neoforge: 'NeoForge',
  quilt: 'Quilt',
  optifine: 'OptiFine'
};

const VERSION_IDS = [
  '1.8', '1.8.1', '1.8.2', '1.8.3', '1.8.4', '1.8.5', '1.8.6', '1.8.7', '1.8.8', '1.8.9',
  '1.9', '1.9.1', '1.9.2', '1.9.3', '1.9.4',
  '1.10', '1.10.1', '1.10.2',
  '1.11', '1.11.1', '1.11.2',
  '1.12', '1.12.1', '1.12.2',
  '1.13', '1.13.1', '1.13.2',
  '1.14', '1.14.1', '1.14.2', '1.14.3', '1.14.4',
  '1.15', '1.15.1', '1.15.2',
  '1.16', '1.16.1', '1.16.2', '1.16.3', '1.16.4', '1.16.5',
  '1.17', '1.17.1',
  '1.18', '1.18.1', '1.18.2',
  '1.19', '1.19.1', '1.19.2', '1.19.3', '1.19.4',
  '1.20', '1.20.1', '1.20.2', '1.20.3', '1.20.4', '1.20.5', '1.20.6',
  '1.21', '1.21.1', '1.21.2', '1.21.3', '1.21.4', '1.21.5', '1.21.6', '1.21.7', '1.21.8', '1.21.9', '1.21.10', '1.21.11',
  '26.1', '26.1.1', '26.1.2', '26.2'
];

const PREVIEW_CFG = {
  selectedVersion: '1.21.4',
  vanillaVersion: '26.2',
  pulseLoaderId: 'fabric:0.16.10@1.21.4',
  vanillaLoaderId: 'vanilla:26.2',
  ramMb: 2048,
  autoUpdateMods: true,
  autoDisableIncompatibleMods: true,
  useDownloadedModsLibrary: true,
  musicEnabled: true,
  musicVolume: 70,
  lastTheme: 'vulkan',
  userName: 'Player',
  javaPath: '',
  autoJava: true,
  msaClientId: '',
  curseforgeKey: '',
  modSource: 'modrinth',
  language: 'ru',
  // Превью в файловом режиме: один офлайн-аккаунт, как при первом запуске
  accounts: [{ id: 'preview', type: 'offline', name: 'Player', uuid: '', initial: 'P', microsoft: false, lastLogin: 0 }],
  activeAccountId: 'preview',
  paths: {
    minecraft: '%appdata%/pulsePLUS/minecraft',
    vanilla: '%appdata%/pulsePLUS/vanilla',
    music: '%appdata%/pulsePLUS/music'
  }
};

const PREVIEW_VERSIONS = VERSION_IDS.map((id) => ({ id, available: 'true', type: 'release' }));

const PREVIEW_LOADER_CATALOG = {
  '1.16.4': [
    loaderObject('vanilla', '1.16.4', '1.16.4', '', true),
    loaderObject('forge', '1.16.4', '35.1.37', 'latest', false),
    loaderObject('forge', '1.16.4', '35.1.4', 'recommended', true),
    loaderObject('fabric', '1.16.4', '0.19.3', '', false),
    loaderObject('quilt', '1.16.4', '0.26.4-beta.1', '', false)
  ],
  '1.21.4': [
    loaderObject('vanilla', '1.21.4', '1.21.4', '', true),
    loaderObject('fabric', '1.21.4', '0.16.10', '', true),
    loaderObject('forge', '1.21.4', '54.1.16', 'latest', false),
    loaderObject('forge', '1.21.4', '54.1.14', 'recommended', false),
    loaderObject('neoforge', '1.21.4', '21.4.148-beta', '', false),
    loaderObject('quilt', '1.21.4', '0.29.3-beta.1', '', false)
  ],
  '26.2': [
    loaderObject('vanilla', '26.2', '26.2', '', true),
    loaderObject('fabric', '26.2', '0.18.2', '', false),
    loaderObject('forge', '26.2', '65.0.1', 'latest', true),
    loaderObject('neoforge', '26.2', '26.2.14-beta', '', false)
  ]
};

const PREVIEW_MODS = [
  { name: 'Sodium', version: '0.6.13', fileName: 'sodium.jar', enabled: true, compatible: true, downloaded: false, latestKnownVersion: '0.6.x' },
  { name: 'Fabric API', version: '0.129.0', fileName: 'fabric-api.jar', enabled: true, compatible: true, downloaded: false, latestKnownVersion: '0.129.x' },
  { name: 'Better Ping Display', version: '1.2.0', fileName: 'better-ping.jar', enabled: true, compatible: false, downloaded: false, latestKnownVersion: '1.2.0' },
  { name: 'ModMenu', version: '14.0.0-rc.2', fileName: 'modmenu.jar', enabled: false, compatible: true, downloaded: false, latestKnownVersion: '14.x' },
  { name: 'Iris', version: '1.8.12', fileName: 'iris.jar', enabled: false, compatible: true, downloaded: true, latestKnownVersion: '1.8.x' }
];

const PREVIEW_BROWSER_MODS = [
  {
    name: 'Sodium',
    author: 'CaffeineMC',
    desc: 'Renderer replacement with large FPS gains.',
    slug: 'sodium',
    url: 'https://modrinth.com/mod/sodium',
    loaders: ['Fabric', 'NeoForge', 'Quilt'],
    versions: ['1.16.4', '1.16.5', '1.20.1', '1.21.4', '1.21.5', '1.21.11', '26.2'],
    downloads: 173956583
  },
  {
    name: 'JEI',
    author: 'mezz',
    desc: 'Recipe and item browser for Forge style packs.',
    slug: 'jei',
    url: 'https://modrinth.com/mod/jei',
    loaders: ['Forge', 'NeoForge'],
    versions: ['1.16.4', '1.20.1', '1.21.4', '26.2'],
    downloads: 50000000
  },
  {
    name: 'Mod Menu',
    author: 'TerraformersMC',
    desc: 'Shows installed mods and config shortcuts in game.',
    slug: 'modmenu',
    url: 'https://modrinth.com/mod/modmenu',
    loaders: ['Fabric', 'Quilt'],
    versions: ['1.16.4', '1.20.1', '1.21.4', '1.21.11'],
    downloads: 100000000
  }
];

// Videos are served from the /videos/ endpoint (files next to JAR); no embedded fallbacks
const PLAY_VIDEO_CANDIDATES = [
  VIDEO_BASE + 'pulsePLUS_play.mp4'
];

const MODS_VIDEO_CANDIDATES = [
  VIDEO_BASE + 'pulsePLUS_mods.mp4'
];

// Фон вкладки «Настройки». В поставке ролика для неё нет — его кладут в папку
// данных рядом с остальными (см. videosDir в installer/main.js). Первый
// найденный вариант и играет, поэтому в списке следом стоит ролик play: пока
// своего файла нет, вкладка показывает его, а не остаётся без фона.
const SETTINGS_VIDEO_CANDIDATES = [
  VIDEO_BASE + 'pulsePLUS_settings.mp4',
  VIDEO_BASE + 'pulsePLUS_play.mp4'
];

const PREVIEW_TRACKS = [
  { type: 'mp3', title: 'opaque', src: 'assets/music/corpsse_-_opaque_(SkySound.cc).mp3' },
  { type: 'mp3', title: 'chto tebya glozhet', src: 'assets/music/k0vertessence_B4YLUm_-_chto_tebya_glozhet_(SkySound.cc).mp3' },
  { type: 'mp3', title: 'Kn1Gsw0Rd', src: 'assets/music/Kn1Gsw0Rd%20.mp3' },
  { type: 'bytebeat', title: 'Saturn', source: 'bytebeat/saturn.txt', mode: 'floatbeat', sampleRate: 44100 },
  { type: 'bytebeat', title: 'Dream Space', source: 'bytebeat/dream_space.txt', mode: 'floatbeat', sampleRate: 44100 }
];

let cfg = {};
let versions = [];
let accounts = [];
let activeAccountId = '';
let msaState = null;   // ожидающий вход Microsoft: код, ссылка и таймер опроса
let mods = [];
let selectedMod = null;
/* Оформление. Раньше здесь была ещё и переменная режима: «vulkan» жёстко
   ставил 1.21.4 с Fabric, «vanilla» давал свободный выбор версии и загрузчика.
   Режим остался один — тот, что был у Vanilla, — поэтому режим больше не
   переменная, а константа. */
let currentTheme = 'vulkan';
const PROFILE_MODE = 'vanilla';
let currentTab = 'play';
let currentMusicTab = 'bytebeat';
let browserSearchTimer = null;
let browserMods = PREVIEW_BROWSER_MODS.slice();
let audioA = null;
let audioB = null;
let activeAudio = null;
let currentTrackIndex = -1;
let activeBytebeat = null;
let activeBytebeatSource = null;
let bytebeatGain = null;
let bytebeatTimer = null;
let bytebeatCtx = null;
let previewTrackList = PREVIEW_TRACKS.slice();
let dynamicLoaderCache = new Map();
let dynamicModsCache = new Map();
let musicState = {
  playing: true,
  volume: 70,
  currentTrack: '',
  currentTrackType: 'idle',
  crossfadeSeconds: 4,
  musicDir: '',
  playlist: []
};

// Resume AudioContext after any user gesture (browser policy)
document.addEventListener('click', resumeAudioContextOnce, { capture: true });
document.addEventListener('keydown', resumeAudioContextOnce, { capture: true });

window.addEventListener('DOMContentLoaded', async () => {
  bindFallbackWindowButtons();
  // Окно ely.by закрыли — скин там могли только что поменять. Молча: закрывают
  // его и просто так, а тост на каждое закрытие был бы шумом.
  if (window.pulse && typeof window.pulse.onElyByClosed === 'function') {
    window.pulse.onElyByClosed(() => onElybyWindowClosed());
  }
  setupAudioPlayers();
  setupBackgroundVideos();
  // Ролики привязываются оба сразу, и оба начинают играть: слой вкладки «моды»
  // в разметке скрыт, но скрытость его не останавливает. Решение по каждому
  // слою принимается здесь и только здесь — дальше оно пересматривается при
  // смене вкладки, режима, фокуса и сворачивании.
  syncVideoPlayback();
  setupParallax();
  setupCursorBlur();
  watchIdle();          // фон на паузу, если игрок отошёл
  setStaticLogo();

  // Язык переключается на лету, но статическая разметка с data-i18n — это
  // только часть интерфейса: подписи в списках собираются в JS и после смены
  // языка оставались на прежнем (например, «скачана» у версии). Рисуем их
  // заново — отрисовщики берут текст через t() и подхватят новый язык.
  I18N.onChange(() => {
    renderVersionList();
    renderAccounts();
    renderMods();
    renderMP3List();
  });

  // Свёрнутое окно не должно декодировать видео и считать волну: Electron у нас
  // с отключённым троттлингом фона, сам он это не остановит
  document.addEventListener('visibilitychange', () => {
    syncVideoPlayback();
    if (window.FX && typeof window.FX.setPaused === 'function') window.FX.setPaused(document.hidden);
  });

  // Окно потеряло фокус — это и есть «игрок ушёл в игру»: лаунчер остаётся
  // открытым и уходит под окно игры. Скрытым он себя при этом не считает —
  // троттлинг фона отключён (см. main.js), и на живой игре замерено
  // document.hidden = false, visibility = "visible". Поэтому фокус слушаем
  // отдельно. Ролики на паузу, звук не трогаем: троттлинг отключён как раз
  // ради него. Обратно — по возвращении фокуса.
  //
  // Спрашиваем у главного процесса, а не у страницы: замер показал, что
  // document.hasFocus() остаётся true, когда активное окно уже чужое, —
  // на этом пауза и висела. Слушатели ниже остаются запасным путём для
  // тестовых страниц, которые открывают в обычном браузере, без Electron.
  //
  // Начальное состояние берём «в фокусе», не глядя на ответ: запущенное окно
  // может ещё не успеть стать активным, и по честному ответу фон замирал бы
  // прямо на старте. Пауза — это реакция на потерю фокуса, а не на его
  // отсутствие при открытии.
  if (window.pulse && window.pulse.onFocusChange) {
    window.pulse.onFocusChange((focused) => { windowFocused = focused; syncVideoPlayback(); });
  } else {
    windowFocused = document.hasFocus();
    window.addEventListener('blur', () => { windowFocused = false; syncVideoPlayback(); });
    window.addEventListener('focus', () => { windowFocused = true; syncVideoPlayback(); });
  }

  await loadState();
  await loadVersions();
  applyStateToUi();
  applyInitialThemeFromUrl();
  await ensureActiveLoader();
  await loadMods();
  await loadMusicState();
  await loadBrowserMods('');
});

function loaderObject(familyKey, mcVersion, build, channel, recommended) {
  return {
    id: familyKey === 'vanilla' ? `vanilla:${mcVersion}` : `${familyKey}:${build}@${mcVersion}`,
    familyKey,
    family: LOADER_FAMILY_LABELS[familyKey] || familyKey,
    mcVersion,
    build,
    channel,
    recommended,
    label: familyKey === 'vanilla' ? `Vanilla ${mcVersion}` : `${LOADER_FAMILY_LABELS[familyKey] || familyKey} ${build}`
  };
}

/**
 * Открыть папку текущей сборки.
 *
 * Путь считает бэкенд, а не окно: имя сборки складывается из версии и
 * загрузчика по тем же правилам, что и папка версии на диске, и второй такой
 * расчёт здесь однажды разошёлся бы с первым. Кнопка открывает именно ту папку,
 * куда игра пишет миры и моды, — свою у каждой сборки.
 *
 * В браузерной сборке (без Electron) проводник открыть нечем: показываем путь,
 * по нему игрок дойдёт сам.
 */
async function openCurrentFolder() {
  let dir = null;
  try {
    const q = `mode=${encodeURIComponent(PROFILE_MODE)}`
      + `&version=${encodeURIComponent(activeVersion())}`
      + `&loader=${encodeURIComponent(currentLoaderId() || '')}`;
    const info = await fetchJson(`/api/instance-dir?${q}`);
    if (info && info.dir) dir = info.dir;
  } catch (_) { /* покажем то, что есть: общую папку игры */ }

  const fallback = cfg && cfg.paths && cfg.paths.vanilla;
  const target = dir || fallback || null;

  // Проводник умеет открывать только оболочка. В браузерной сборке (та, что без
  // Electron, для слабых машин) её нет — там показываем путь: по нему игрок
  // дойдёт сам. Спрашивать надо именно Electron, а не наличие window.pulse:
  // заглушка для браузера создаёт его же.
  const inElectron = typeof window.pulse?.openFolder === 'function'
    && /electron/i.test(navigator.userAgent || '');

  if (inElectron) {
    window.pulse.openFolder(target);
    if (dir) toast(t('folder.opened').replace('{path}', dir));
  } else if (target) {
    toast(t('folder.path').replace('{path}', target));
  } else {
    toast('Open folder works in Electron build', 'ok');
  }
}

/**
 * Дописать заглушку метода, которого нет в window.pulse.
 *
 * Запись обёрнута в try: объект из contextBridge заморожен, и присваивание в
 * него бросает. Ошибка тут унесла бы за собой весь bindFallbackWindowButtons,
 * то есть разом все кнопки окна, — а нехватка одного метода такого не стоит.
 */
function fallbackPulse(name, fn) {
  if (window.pulse && typeof window.pulse[name] === 'function') return;
  try { window.pulse[name] = fn; } catch (_) { /* заморожен оболочкой */ }
}

function bindFallbackWindowButtons() {
  if (!window.pulse) window.pulse = {};
  fallbackPulse('openFolder', () => toast('Open folder works in Electron build', 'ok'));
  fallbackPulse('minimize', () => document.body.classList.toggle('preview-minimized'));
  fallbackPulse('maximize', async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen().catch(() => toast('Fullscreen not available here', 'err'));
  });
  fallbackPulse('close', () => {
    window.close();
    setTimeout(() => { if (!window.closed) location.href = 'about:blank'; }, 100);
  });
}

// Close the launcher with a short goodbye animation, then actually quit.
let _closing = false;
function closeLauncher() {
  if (_closing) return;
  _closing = true;
  const overlay = $('#goodbyeOverlay');
  const title = $('#goodbyeTitle');
  if (title) title.textContent = t('bye.titleName', { name: cfg.userName || 'Player' });
  document.body.classList.add('closing');
  if (overlay) overlay.classList.add('show');
  // Let the goodbye animation play, then quit
  setTimeout(() => {
    if (window.pulse && typeof window.pulse.close === 'function') window.pulse.close();
  }, 950);
}

function setupAudioPlayers() {
  audioA = new Audio();
  audioB = new Audio();
  [audioA, audioB].forEach((audio) => {
    audio.loop = false;
    audio.preload = 'auto';
    audio.addEventListener('ended', () => {
      if (musicState.playing && activeAudio === audio) nextTrack();
    });
  });
  activeAudio = audioA;
}

function setupBackgroundVideos() {
  const sets = videoSetsFor(currentTheme);
  bindVideoCandidates($('#bgPlay'), sets.play);
  bindVideoCandidates($('#bgMods'), sets.mods);
  bindVideoCandidates($('#bgSettings'), sets.settings);
}

function bindVideoCandidates(video, candidates) {
  if (!video) return;
  // Skip reload if already playing the same set of candidates
  const key = candidates.join('|');
  if (video._pulseKey === key && video.readyState >= 3 && !video.paused) return;
  video._pulseKey = key;

  // Remove old listeners to prevent accumulation
  if (video._pulseErrorHandler) video.removeEventListener('error', video._pulseErrorHandler);
  if (video._pulseLoadHandler) video.removeEventListener('loadeddata', video._pulseLoadHandler);

  video.classList.remove('is-missing');
  let index = 0;
  let active = false; // true after first successful load

  const tryNext = () => {
    if (active) return; // don't re-try if already playing fine
    if (index >= candidates.length) {
      video.classList.add('is-missing');
      return;
    }
    video.src = candidates[index++];
    video.load();
  };

  const onLoaded = () => {
    active = true;
    video.classList.remove('is-missing');
    // Запускать или нет — решает syncVideoPlayback, и к моменту загрузки ролика
    // решение уже принято: он мог оказаться скрытым слоем или прийтись на
    // запущенную игру с окном лаунчера под ней.
    if (video._pulseWanted !== false) video.play().catch(() => {});
  };

  video._pulseErrorHandler = tryNext;
  video._pulseLoadHandler = onLoaded;
  video.addEventListener('error', tryNext);
  video.addEventListener('loadeddata', onLoaded);
  tryNext();
}

function setupParallax() {
  const shell = $('.app-shell');
  const content = $('.content');
  const bgPlay = $('#bgPlay');
  const bgMods = $('#bgMods');
  const bgSettings = $('#bgSettings');
  if (!shell || !content) return;

  let targetX = 0, targetY = 0;
  let currentX = 0, currentY = 0;
  let rafId = null;
  let lastRafTime = 0;
  const FPS_CAP = 1000 / 40; // max 40fps для параллакса

  function lerp(a, b, t) { return a + (b - a) * t; }

  function animateParallax(now) {
    if (now - lastRafTime < FPS_CAP) {
      rafId = requestAnimationFrame(animateParallax);
      return;
    }
    lastRafTime = now;

    currentX = lerp(currentX, targetX, 0.08);
    currentY = lerp(currentY, targetY, 0.08);

    // lerp никогда не достигает цели точно, поэтому раньше трансформы
    // перезаписывались каждый кадр вхолостую — а это пересчёт стилей и слоёв.
    // Как только смещение догнало цель, останавливаем цикл; движение мыши его разбудит.
    const settled = Math.abs(targetX - currentX) < 0.001 && Math.abs(targetY - currentY) < 0.001;
    if (settled) {
      currentX = targetX;
      currentY = targetY;
      rafId = null;
    } else {
      rafId = requestAnimationFrame(animateParallax);
    }

    const cx = currentX, cy = currentY;

    // Лёгкое смещение контента (без тяжёлой 3D-перспективы на всём shell)
    content.style.transform = `translate3d(${(cx * 5).toFixed(1)}px, ${(cy * 3).toFixed(1)}px, 0)`;
    // Видео двигается в противоположную сторону — создаёт глубину
    [bgPlay, bgMods, bgSettings].forEach((video) => {
      if (!video) return;
      video.style.transform = `scale(1.06) translate3d(${(cx * -14).toFixed(1)}px, ${(cy * -9).toFixed(1)}px, 0)`;
    });
  }

  document.addEventListener('mousemove', (event) => {
    targetX = (event.clientX / window.innerWidth - 0.5) * 2;
    targetY = (event.clientY / window.innerHeight - 0.5) * 2;
    if (!rafId) rafId = requestAnimationFrame(animateParallax);
  });

  document.addEventListener('mouseleave', () => {
    targetX = 0;
    targetY = 0;
  });
}

// Spring-physics blur circle that trails the cursor (motion.dev style).
function setupCursorBlur() {
  const el = document.getElementById('cursorBlur');
  if (!el) return;
  let mx = window.innerWidth / 2, my = window.innerHeight / 2;
  let x = mx, y = my, vx = 0, vy = 0;
  // Real spring physics (Hooke's law + damping): lower stiffness = more lag,
  // lower damping = more overshoot/bounce. Tuned so the circle visibly chases
  // the cursor and settles with a soft springy overshoot instead of glued-on.
  const stiffness = 0.045, damping = 0.78;
  let shown = false;
  document.addEventListener('mousemove', (e) => {
    mx = e.clientX; my = e.clientY;
    if (!shown) { shown = true; el.classList.add('visible'); }
  }, { passive: true });
  document.addEventListener('mouseleave', () => { el.classList.remove('visible'); shown = false; });
  const tick = () => {
    // acceleration = spring pull toward target; velocity accumulates then damps
    const ax = (mx - x) * stiffness;
    const ay = (my - y) * stiffness;
    vx = (vx + ax) * damping; x += vx;
    vy = (vy + ay) * damping; y += vy;
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Replay the staggered text reveal inside a container.
function replayStagger(container) {
  if (!container) return;
  // Разбор на буквы пересобираем ДО перезапуска: у нового текста другая длина,
  // а значит другой шаг волны. Наблюдатель внутри TextReveal сработает уже
  // после старта анимации, и она ушла бы с прошлыми номерами букв.
  if (window.TextReveal) {
    container.querySelectorAll('[data-t-chars]').forEach((el) => window.TextReveal.build(el));
  }
  container.classList.remove('is-shown');
  // Force reflow so the class re-add restarts the transition
  void container.offsetWidth;
  container.classList.add('is-shown');
}

function setStaticLogo() {
  // Fixed brand name applied across the UI
  $('#logoText').innerHTML = escapeHtml(LAUNCHER_NAME) + '<span class="caret">_</span>';
  // Update titlebar span
  const titleEl = document.querySelector('.title');
  if (titleEl) titleEl.innerHTML = `<b>${escapeHtml(LAUNCHER_NAME)}</b> Launcher`;
  // Update browser tab title
  document.title = `${LAUNCHER_NAME} Launcher`;
}

async function loadState() {
  if (IS_FILE_PREVIEW) {
    cfg = structuredClone(PREVIEW_CFG);
    setAccounts(cfg);
    return;
  }
  // Retry up to 15 times with 400ms delay — backend may still be initialising
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      cfg = await fetchJson('/api/state');
      setAccounts(cfg);
      return;
    } catch {
      if (attempt < 14) await new Promise(r => setTimeout(r, 400));
    }
  }
  cfg = structuredClone(PREVIEW_CFG);
  setAccounts(cfg);
}

async function loadVersions() {
  if (IS_FILE_PREVIEW) {
    versions = PREVIEW_VERSIONS.slice();
  } else {
    try {
      const data = await fetchJson('/api/versions');
      versions = data.versions?.length ? sortVersions(data.versions) : PREVIEW_VERSIONS.slice();
    } catch {
      versions = PREVIEW_VERSIONS.slice();
    }
  }
  renderVersionList();
  renderVanillaVersionSelect();
}

function sortVersions(list) {
  const order = new Map(VERSION_IDS.map((id, index) => [id, index]));
  return list
    .filter((item) => item.id && order.has(item.id))
    .sort((a, b) => order.get(a.id) - order.get(b.id));
}

function applyStateToUi() {
  cfg = {
    ...PREVIEW_CFG,
    ...cfg,
    paths: { ...PREVIEW_CFG.paths, ...(cfg.paths || {}) }
  };
  currentTheme = cfg.lastTheme || 'vulkan';
  /* Версия и загрузчик хранились парами: своя у режима чита, своя у Vanilla.
     Режим один, поле одно. Старые значения из config.json переносим, чтобы у
     тех, кто уже пользовался лаунчером, выбор не сбросился на умолчание. */
  cfg.vanillaVersion ||= PREVIEW_CFG.vanillaVersion;
  cfg.vanillaLoaderId ||= PREVIEW_CFG.vanillaLoaderId;
  cfg.selectedVersion = cfg.vanillaVersion;
  cfg.loaderId = cfg.vanillaLoaderId;

  $('#javaPath').value = cfg.javaPath || '';
  $('#autoJava').checked = cfg.autoJava !== false;
  $('#ramSlider').value = cfg.ramMb || 2048;
  $('#autoUpdateMods').checked = !!cfg.autoUpdateMods;
  $('#autoDisableMods').checked = !!cfg.autoDisableIncompatibleMods;
  $('#useDownloadedModsLibrary').checked = !!cfg.useDownloadedModsLibrary;
  $('#musicEnabled').checked = cfg.musicEnabled !== false;
  $('#musicVolumeSlider').value = cfg.musicVolume ?? 70;
  $('#musicVolumeSettings').value = cfg.musicVolume ?? 70;
  const keyInput = $('#curseforgeKey');
  if (keyInput) keyInput.value = cfg.curseforgeKey || '';
  syncModSourceSwitch();
  applyLanguage(cfg.language || 'ru', false);
  applyActiveAccountToSidebar();
  updateRam($('#ramSlider').value);
  onMusicVolume(cfg.musicVolume ?? 70, false);
  setTheme(currentTheme, false);
}

// ── Аккаунты ─────────────────────────────────────────────────────────────────

function activeAccount() {
  return accounts.find((a) => a.id === activeAccountId) || accounts[0] || null;
}

/**
 * Голова игрока вместо буквы.
 *
 * Буква лежит не под картинкой, а поверх неё: фон рисуется за текстом, поэтому
 * мало надеть фон — букву надо погасить. Отсюда класс `has-skin`, который и
 * красит фон, и делает текст прозрачным. Гасим только по факту загрузки
 * картинки, чтобы ник без скина (404) остался с буквой, а не с пустым квадратом.
 */
/**
 * Метка версии скина для адреса картинки.
 *
 * Браузер кэширует по полному URL, а сервер отдаёт скин с Cache-Control на час.
 * После сброса кэша на сервере старый адрес всё ещё указывал бы на старую
 * картинку в памяти браузера, поэтому с этого момента ко всем адресам скина
 * добавляется метка времени. Ноль означает «ничего не сбрасывали»: тогда
 * адрес чистый и обычное кэширование работает.
 */
let skinBust = 0;

function applySkinToAvatar(el, nick) {
  if (!el) return;
  // Токен — от гонки: при быстром переключении аккаунтов медленный ответ
  // первого ника не должен перебить уже надетый скин второго.
  const token = (el._skinToken || 0) + 1;
  el._skinToken = token;
  if (!nick) {
    el.classList.remove('has-skin');
    el.style.removeProperty('--skin');
    return;
  }
  // Ник уходит в путь URL через encodeURIComponent, а разбирается с ним сервер:
  // на некорректный он ответит 400, и класс не наденется.
  const url = skinUrl(nick, false);
  // Класс вешается по факту загрузки, а не сразу: буква гаснет только под
  // настоящей головой. Иначе ник без скина дал бы пустой квадрат — ни буквы,
  // ни головы. Картинка потом берётся из кэша браузера, повторного запроса нет.
  const probe = new Image();
  probe.onload = () => {
    if (el._skinToken !== token) return;
    el.style.setProperty('--skin', `url("${url}")`);
    el.classList.add('has-skin');
  };
  probe.onerror = () => {
    if (el._skinToken !== token) return;
    el.classList.remove('has-skin');
    el.style.removeProperty('--skin');
  };
  probe.src = url;
}

/** Адрес скина, плаща или их сброса. Метка версии — только после сброса кэша. */
function skinUrl(nick, wantCape, action) {
  const base = `${API}/api/skin/${encodeURIComponent(nick)}`;
  const tail = action ? `/${action}` : (wantCape ? '/cape' : '');
  return base + tail + (skinBust ? `?t=${skinBust}` : '');
}

/**
 * Окно ely.by: регистрация, вход и загрузка скина.
 *
 * Наружу уходит ключ страницы, а не адрес: куда именно идти, решает окно, и
 * произвольная навигация из страницы туда не просочится.
 */
function openElyBy(page) {
  const which = page === 'login' ? 'login' : 'register';
  if (window.pulse && typeof window.pulse.openElyBy === 'function') {
    window.pulse.openElyBy(which);
    return;
  }
  // В браузере окна нет — открываем вкладку, чтобы кнопка не молчала
  window.open(`https://account.ely.by/${which}`, '_blank');
}

// ── ely.by: кто вошёл и что с этим делать ───────────────────────────────────
//
// Состояние входа спрашиваем у оболочки, а не у бэкенда: сессия сайта живёт в
// партиции Chromium (cookie identity на домене ely.by), и Java её не видит.
//
// `known` — отдельный флаг, и он важен. Если спросить не удалось (нет оболочки
// или ely.by не ответил), кнопки входа обязаны остаться на экране: спрятать их,
// не зная наверняка, — значит отобрать у игрока единственный способ войти.

let elyby = { known: false, loggedIn: false, nick: '', offline: false, busy: false };

async function loadElyby() {
  if (!window.pulse || typeof window.pulse.elybyState !== 'function') {
    elyby = { known: false, loggedIn: false, nick: '', offline: false, busy: false };
    return elyby;
  }
  try {
    const st = await window.pulse.elybyState();
    elyby = {
      known: true,
      loggedIn: !!(st && st.loggedIn),
      nick: (st && st.nick) || '',
      offline: !!(st && st.offline),
      busy: false
    };
  } catch (_) {
    // Спросили и не получили ответа — это «неизвестно», а не «не вошёл»
    elyby = { known: false, loggedIn: false, nick: '', offline: true, busy: false };
  }
  return elyby;
}

/**
 * Завести ник с ely.by обычным аккаунтом лаунчера.
 *
 * Без этого надевание уходит в пустоту: в списке такого ника нет, играть под
 * ним нельзя, и увидеть новый скин негде. Профиль с тем же ником бэкенд
 * повышает до ely.by, а не заводит второй строкой, — двух «propadar» в списке
 * быть не должно.
 *
 * Возвращает true, только если список изменился: перерисовывать его на каждый
 * вход в панель незачем.
 */
async function syncElybyAccount() {
  if (!elyby.loggedIn || !elyby.nick) return false;
  const nick = elyby.nick.toLowerCase();
  if (accounts.some((a) => a.elyby && a.name.toLowerCase() === nick)) return false;
  try {
    setAccounts(await fetchJson('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add-elyby', name: elyby.nick })
    }));
    return true;
  } catch (_) {
    return false;
  }
}

/** Кнопка панели: обычная кнопка с классом ghost-btn. */
function ghostBtn(text, onClick) {
  const b = document.createElement('button');
  b.className = 'ghost-btn';
  b.textContent = text;
  b.onclick = onClick;
  return b;
}

function elybyHint(text) {
  const d = document.createElement('div');
  d.className = 'account-hint';
  d.textContent = text;
  return d;
}

/**
 * Блок ely.by в панели аккаунтов.
 *
 * Пока входа нет — «Регистрация» и «Войти». Как только вошли, обе кнопки
 * уходят с экрана: они уже сделали своё дело, а на их месте появляется ник —
 * единственное, что игроку теперь нужно знать. Сессия кончилась (или её
 * стёрли кнопкой «Выйти») — кнопки возвращаются, потому что вернуться к
 * странице входа иначе неоткуда.
 *
 * Каталог скинов виден всегда: он публичный, смотреть можно и без входа.
 */
function renderElybyBlock() {
  const host = $('#elybyBody');
  if (!host) return;
  host.textContent = '';

  const state = document.createElement('div');
  state.className = 'ely-state';
  const dot = document.createElement('span');
  dot.className = 'ely-dot' + (elyby.loggedIn ? ' ely-dot--on' : '');
  state.append(dot);
  if (elyby.loggedIn) {
    state.append(document.createTextNode(t('acc.elyLoggedAs') + ' '));
    const b = document.createElement('b');
    b.textContent = elyby.nick;
    state.append(b);
  } else {
    state.append(document.createTextNode(
      t(elyby.offline ? 'acc.elyOffline' : 'acc.elyNotLogged')));
  }
  host.append(state);

  const auth = document.createElement('div');
  auth.className = 'account-add-row';
  if (elyby.loggedIn) {
    // «Сменить» ведёт на ту же страницу входа: там же меняют аккаунт
    auth.append(ghostBtn(t('acc.elySwitch'), () => openElyBy('login')));
    auth.append(ghostBtn(t('acc.elyLogout'), elybyLogout));
  } else {
    auth.append(ghostBtn(t('acc.elyRegister'), () => openElyBy('register')));
    auth.append(ghostBtn(t('acc.elyLogin'), () => openElyBy('login')));
  }
  host.append(auth);

  const actions = document.createElement('div');
  actions.className = 'account-add-row';
  actions.append(ghostBtn(t('acc.skinsOpen'), () => openSkins()));
  const nick = elyby.loggedIn && elyby.nick ? elyby.nick : null;
  actions.append(ghostBtn(t('acc.skinRefresh'), () => refreshSkinOf(nick, false)));
  host.append(actions);

  host.append(elybyHint(elyby.loggedIn ? t('acc.elyHintIn') : t('acc.elyHint')));
  host.append(elybyHint(t('acc.skinHint')));
}

/** Выход: стираем сессию окна и возвращаем кнопки входа. */
async function elybyLogout() {
  if (!confirm(t('acc.elyLogoutAsk'))) return;
  if (window.pulse && typeof window.pulse.elybyLogout === 'function') {
    await window.pulse.elybyLogout();
  }
  // Отметка ely.by на профиле больше не правда: сессии нет
  try {
    setAccounts(await fetchJson('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'forget-elyby' })
    }));
  } catch (_) { /* не вышло — покажем состояние как есть */ }
  await loadElyby();
  renderElybyBlock();
  renderAccounts();
  toast(t('acc.elyLoggedOut'), 'ok');
}

/**
 * Окно ely.by закрыли.
 *
 * Молча: закрывают его и просто так, а тост на каждое закрытие — шум. Но скин
 * там могли только что поменять, поэтому перечитываем и состояние входа (ник
 * мог появиться впервые), и скин именно того ника, что стоит на ely.by, — а не
 * активного аккаунта: это разные люди, если игрок выбрал другой профиль.
 */
async function onElybyWindowClosed() {
  // Скин там могли только что поменять, поэтому перечитываем и состояние входа
  // (ник мог появиться впервые), и скин именно того ника, что стоит на ely.by,
  // — а не активного аккаунта: это разные люди, если выбран другой профиль.
  const was = elyby.nick;   // ник до перечитывания: окно могли и не логинить
  await elybyRefresh();
  await refreshSkinOf(elyby.loggedIn ? elyby.nick : was, true);
}

/**
 * Забыть скачанный скин ника и перечитать его.
 *
 * Нужно после смены скина на сайте: SkinService держит удачный ответ сутки, а
 * «ник не найден» — час. Без сброса свежий скин не появился бы вовсе, и это
 * выглядело бы как «фича не работает».
 *
 * Ник параметром, а не из активного аккаунта: скин меняют на ely.by, а играть
 * при этом могут под другим профилем. Сбросить надо тот ник, который меняли.
 */
async function refreshSkinOf(nick, silent) {
  const name = (nick || '').trim();
  if (!name) {
    if (!silent) toast(t('acc.skinNoAccount'), 'err');
    return false;
  }
  try {
    const r = await fetch(skinUrl(name, false, 'refresh'), { method: 'POST' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
  } catch (e) {
    if (!silent) toast(t('acc.skinFailed'), 'err');
    return false;
  }
  // Метка версии растёт всегда, а не только когда ник сейчас на экране: без неё
  // браузер отдал бы свою копию по старому адресу при первом же переключении
  skinBust = Date.now();
  applyActiveAccountToSidebar();
  if ($('#accountPanel')?.dataset.open === 'true') renderAccounts();
  if (!silent) toast(t('acc.skinUpdated'), 'ok');
  return true;
}

/** То же для активного аккаунта — кнопка «Обновить скин» без ника. */
function refreshSkin(silent) {
  const acc = activeAccount();
  return refreshSkinOf(acc ? acc.name : '', silent);
}

/**
 * Записать нику скин, который игрок только что надел в витрине.
 *
 * Почему не перечитать. Скин по нику ely.by отдаёт с длинной задержкой:
 * проверено живьём — учётка приняла новый скин сразу, а файл по нику отдавал
 * прежний ещё шесть минут. Перечитав сразу после надевания, мы запомнили бы
 * прежний скин на сутки — то есть «надел, а не поменялось» осталось бы на месте
 * уже по другой причине. Поэтому отдаём серверу хеш — ту самую картинку, которую
 * игрок выбрал и которую он только что видел в сетке.
 *
 * Отказ (409 — картинки у нас нет) не беда: откатываемся на обычное чтение.
 */
async function adoptWornSkin(nick, hash) {
  const name = (nick || '').trim();
  if (!name || !hash) return refreshSkinOf(name, true);
  try {
    // Адрес собираем сами, а не через skinUrl: та дописывает метку версии через
    // «?», и склейка с «&hash=» дала бы битый адрес, пока метки ещё нет
    const url = `${API}/api/skin/${encodeURIComponent(name)}/wear`
              + `?hash=${encodeURIComponent(hash)}`;
    const r = await fetch(url, { method: 'POST' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
  } catch (_) {
    return refreshSkinOf(name, true);
  }
  // Метка версии растёт так же, как у перечитывания: без неё браузер отдал бы
  // свою копию картинки по старому адресу
  skinBust = Date.now();
  applyActiveAccountToSidebar();
  if ($('#accountPanel')?.dataset.open === 'true') renderAccounts();
  return true;
}

/** Сайдбар показывает активный аккаунт; старое cfg.userName — запасной вариант. */
function applyActiveAccountToSidebar() {
  const acc = activeAccount();
  const fallback = cfg.userName && cfg.userName.trim() ? cfg.userName.trim() : 'Player';
  const name = acc ? acc.name : fallback;
  const initial = acc && acc.initial ? acc.initial : name.charAt(0).toUpperCase();
  const kind = acc && acc.microsoft ? 'Microsoft'
             : acc && acc.elyby     ? t('acc.kindElyby')
                                    : t('sidebar.localProfile');

  const profileName = $('#profileName');
  if (profileName) profileName.textContent = name;
  const avatar = $('#avatar');
  if (avatar) {
    avatar.textContent = initial;
    // Без аккаунта скина нет: иначе на запасном «Player» подтянулся бы чужой
    // скин одноимённого игрока
    applySkinToAvatar(avatar, acc ? acc.name : null);
  }
  // Тот же скин носит и Стив в диораме. FX может быть ещё не поднят — тогда
  // ник запомнится и применится, как только диорама догрузит текстуры.
  if (window.FX) window.FX.setPlayerSkin(acc ? acc.name : null, skinBust);
  const accountName = $('#accountName');
  if (accountName) accountName.textContent = name;
  const accountState = $('#accountState');
  if (accountState) accountState.textContent = kind;
  const profileMeta = $('#profileMeta');
  if (profileMeta) profileMeta.textContent = `${LAUNCHER_NAME} · ${kind}`;
}

function setAccounts(data) {
  if (Array.isArray(data.accounts)) accounts = data.accounts;
  if (typeof data.activeAccountId === 'string') activeAccountId = data.activeAccountId;
  applyActiveAccountToSidebar();
  if ($('#accountPanel')?.dataset.open === 'true') renderAccounts();
}

function openAccounts() {
  const panel = $('#accountPanel');
  if (!panel) return;
  renderAccounts();
  // Состояние входа — из прошлого раза, чтобы блок не мигал пустотой на
  // открытии; сразу после этого уточняем у ely.by
  renderElybyBlock();
  elybyRefresh();
  panel.dataset.open = 'true';
  const scrim = $('#accountScrim');
  if (scrim) scrim.classList.add('open');
  replayStagger($('#accountStagger'));
  refreshFxObstacles();   // кнопки панели только что появились на экране
}

/**
 * Спросить у оболочки, кто вошёл, и привести список аккаунтов в соответствие.
 *
 * Отдельной функцией, потому что зовут её из двух мест: открытие панели и
 * закрытие окна ely.by.
 */
async function elybyRefresh() {
  await loadElyby();

  // Сессия могла кончиться сама — cookie живёт своим сроком. Тогда значок
  // «ely.by» на строке перестал быть правдой, и его надо снять. Но только
  // когда ответ ТОЧНЫЙ: если ely.by не ответил, мы не знаем ничего и трогать
  // отметку не вправе.
  if (elyby.known && !elyby.loggedIn && accounts.some((a) => a.elyby)) {
    try {
      setAccounts(await fetchJson('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'forget-elyby' })
      }));
    } catch (_) { /* не вышло — покажем как есть, это не повод падать */ }
  }

  renderElybyBlock();
  if (await syncElybyAccount()) renderAccounts();
}

function closeAccounts() {
  const panel = $('#accountPanel');
  if (!panel) return;
  panel.dataset.open = 'false';
  const scrim = $('#accountScrim');
  if (scrim) scrim.classList.remove('open');
  cancelMsaLogin();
  refreshFxObstacles();
}

function renderAccounts() {
  const list = $('#accountList');
  if (!list) return;
  list.textContent = '';

  if (!accounts.length) {
    const empty = document.createElement('div');
    empty.className = 'account-empty';
    empty.textContent = t('acc.empty');
    list.append(empty);
  }

  for (const acc of accounts) {
    const row = document.createElement('div');
    row.className = `account-row${acc.id === activeAccountId ? ' active' : ''}`;
    row.title = acc.id === activeAccountId ? t('acc.active') : t('acc.switchTo');
    row.onclick = () => selectAccount(acc.id);

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = acc.initial || acc.name.charAt(0).toUpperCase();
    applySkinToAvatar(avatar, acc.name);

    const main = document.createElement('div');
    main.className = 'account-row-main';
    const nameEl = document.createElement('div');
    nameEl.className = 'account-row-name';
    nameEl.textContent = acc.name;
    const metaEl = document.createElement('div');
    metaEl.className = 'account-row-meta';
    metaEl.textContent = acc.microsoft ? t('acc.kindMicrosoft')
                       : acc.elyby     ? t('acc.kindElyby')
                                       : t('acc.kindOffline');
    main.append(nameEl, metaEl);

    const badge = document.createElement('span');
    badge.className = `account-badge ${acc.microsoft ? 'msa' : acc.elyby ? 'elyby' : 'offline'}`;
    badge.textContent = acc.microsoft ? 'MSA' : acc.elyby ? 'ely.by' : t('acc.badgeOffline');

    row.append(avatar, main, badge);

    // Последний аккаунт удалять нельзя — без него игра не запустится
    if (accounts.length > 1) {
      const remove = document.createElement('button');
      remove.className = 'account-remove';
      remove.textContent = '✕';
      remove.title = t('acc.remove');
      remove.onclick = (event) => {
        event.stopPropagation();
        removeAccount(acc.id);
      };
      row.append(remove);
    }
    list.append(row);
  }

  renderMsaBlock();
}

function renderMsaBlock() {
  const host = $('#accountMsaBody');
  if (!host) return;
  host.textContent = '';

  if (msaState) {
    const code = document.createElement('div');
    code.className = 'msa-code';
    code.textContent = msaState.userCode;

    const steps = document.createElement('div');
    steps.className = 'msa-steps';
    steps.innerHTML = t('acc.msaSteps', {
      url: `<a href="#">${escapeHtml(msaState.host || 'microsoft.com/link')}</a>`
    });
    const link = steps.querySelector('a');
    if (link) link.onclick = (e) => { e.preventDefault(); openMsaLink(); };

    const status = document.createElement('div');
    status.className = 'msa-status';
    const dot = document.createElement('span');
    dot.className = 'msa-dot';
    status.append(dot, document.createTextNode(t('acc.msaWaiting')));

    const actions = document.createElement('div');
    actions.className = 'msa-actions';
    const openBtn = document.createElement('button');
    openBtn.className = 'ghost-btn';
    openBtn.textContent = t('acc.msaOpenPage');
    openBtn.onclick = openMsaLink;
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'ghost-btn';
    cancelBtn.textContent = t('acc.msaCancel');
    cancelBtn.onclick = cancelMsaLogin;
    actions.append(openBtn, cancelBtn);

    host.append(code, steps, status, actions);
    return;
  }

  const row = document.createElement('div');
  row.className = 'account-add-row';
  const input = document.createElement('input');
  input.id = 'msaClientIdInput';
  input.className = 'text-input';
  input.placeholder = t('acc.clientId');
  input.value = cfg.msaClientId || '';   // значение, а не атрибут — так кавычки не ломают разметку
  const saveBtn = document.createElement('button');
  saveBtn.className = 'ghost-btn';
  saveBtn.textContent = t('common.save');
  saveBtn.onclick = saveMsaClientId;
  row.append(input, saveBtn);

  const hint = document.createElement('div');
  hint.className = 'account-hint';
  hint.textContent = t('acc.msHint');

  const actions = document.createElement('div');
  actions.className = 'msa-actions';
  const loginBtn = document.createElement('button');
  loginBtn.className = 'launch-btn small';
  loginBtn.textContent = t('acc.msLoginAction');
  loginBtn.disabled = !(cfg.msaClientId && cfg.msaClientId.trim());
  loginBtn.onclick = startMicrosoftLogin;
  actions.append(loginBtn);

  const error = document.createElement('div');
  error.className = 'msa-error';
  error.id = 'msaError';

  host.append(row, hint, actions, error);
}

async function addOfflineAccount() {
  const input = $('#accountNameInput');
  const name = input ? input.value.trim() : '';
  if (!name) {
    toast(t('acc.enterNick'), 'err');
    return;
  }
  try {
    setAccounts(await fetchJson('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add-offline', name })
    }));
    if (input) input.value = '';
    const acc = activeAccount();
    toast(acc ? t('acc.addedAs', { name: acc.name }) : t('acc.added'), 'ok');
  } catch (error) {
    toast(t('common.failed', { message: error.message }), 'err');
  }
}

async function selectAccount(id) {
  if (id === activeAccountId) return;
  try {
    setAccounts(await fetchJson('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'select', id })
    }));
    const acc = activeAccount();
    if (acc) toast(t('acc.playingAs', { name: acc.name }), 'ok');
  } catch (error) {
    toast(t('acc.switchFailed', { message: error.message }), 'err');
  }
}

async function removeAccount(id) {
  const acc = accounts.find((a) => a.id === id);
  if (acc && !confirm(t('acc.removeAsk', { name: acc.name }))) return;
  try {
    setAccounts(await fetchJson('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remove', id })
    }));
  } catch (error) {
    toast(t('acc.removeFailed', { message: error.message }), 'err');
  }
}

async function saveMsaClientId() {
  const input = $('#msaClientIdInput');
  if (!input) return;
  cfg.msaClientId = input.value.trim();
  try {
    await fetchJson('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msaClientId: cfg.msaClientId })
    });
    toast(t('acc.clientIdSaved'), 'ok');
  } catch (error) {
    toast(t('acc.saveFailed', { message: error.message }), 'err');
  }
  renderMsaBlock();
}

async function startMicrosoftLogin() {
  const errorBox = $('#msaError');
  if (errorBox) errorBox.textContent = '';
  try {
    const res = await fetchJson('/api/accounts/msa/start', { method: 'POST' });
    msaState = {
      userCode: res.userCode,
      verificationUri: res.verificationUri,
      host: (res.verificationUri || '').replace(/^https?:\/\//, ''),
      // Microsoft просит не частить: слишком частый опрос возвращает slow_down
      interval: Math.max(2, res.interval || 5),
      expiresAt: res.expiresAt,
      timer: null
    };
    renderMsaBlock();
    scheduleMsaPoll();
  } catch (error) {
    if (errorBox) errorBox.textContent = error.message;
    else toast(error.message, 'err');
  }
}

function scheduleMsaPoll() {
  if (!msaState) return;
  clearTimeout(msaState.timer);
  msaState.timer = setTimeout(pollMicrosoftLogin, msaState.interval * 1000);
}

async function pollMicrosoftLogin() {
  if (!msaState) return;
  if (msaState.expiresAt && Date.now() > msaState.expiresAt) {
    cancelMsaLogin();
    toast(t('acc.msaExpired'), 'err');
    return;
  }
  try {
    const res = await fetchJson('/api/accounts/msa/poll', { method: 'POST' });
    if (res.status === 'pending') {
      scheduleMsaPoll();
      return;
    }
    msaState = null;
    setAccounts(res);
    renderMsaBlock();
    toast(res.name ? t('acc.msaLoggedAs', { name: res.name }) : t('acc.msaDone'), 'ok');
  } catch (error) {
    msaState = null;
    renderMsaBlock();
    const errorBox = $('#msaError');
    if (errorBox) errorBox.textContent = error.message;
    else toast(error.message, 'err');
  }
}

function cancelMsaLogin() {
  if (msaState && msaState.timer) clearTimeout(msaState.timer);
  msaState = null;
  renderMsaBlock();
}

function openMsaLink() {
  const url = (msaState && msaState.verificationUri) || 'https://microsoft.com/link';
  if (window.pulse && typeof window.pulse.openExternal === 'function') {
    window.pulse.openExternal(url);
  } else {
    window.open(url, '_blank');
  }
}

function renderVersionList() {
  const list = $('#versionList');
  list.innerHTML = '';
  const currentVersion = activeVersion();
  versions.forEach((version) => {
    /* Выбрана и скачана — два разных состояния, и они складываются: версию
       можно выбрать, ещё не скачав, и наоборот. Поэтому два независимых
       класса, а не один. Если бэкенд про скачанность не сказал (старый jar
       или предпросмотр без сервера) — считаем, что не скачана, и не врём
       игроку зелёным. */
    const selected = currentVersion === version.id;
    const installed = version.installed === true;
    /* Что из этой версии уже лежит на диске. Бэкенд отдаёт сборки отдельным
       списком, потому что у «сама игра» и у «игра плюс загрузчик» разные папки:
       одна зелёная пометка на строку отвечала только про ваниллу, и Fabric
       на 1.21.1 выглядел неустановленным, даже когда был собран. */
    const builtLoaders = Array.isArray(version.loaders) ? version.loaders : [];
    const loaderNames = builtLoaders.map((l) => l.label || `${l.family} ${l.build}`.trim());
    const subtitle = (loaderNames.length ? loaderNames : [activeLoader().family]).join(' · ');
    const row = document.createElement('button');
    row.className = 'version-item'
      + (installed ? ' installed' : '')
      + (selected ? ' active' : '');
    row.dataset.version = version.id;
    row.title = installed ? t('ver.installed') : t('ver.notInstalled');
    if (loaderNames.length) row.title += ` — ${loaderNames.join(', ')}`;
    row.onclick = () => syncSelectedVersion(version.id, true);
    row.innerHTML = `
      <div class="ver-text">
        <div class="ver-main">${escapeHtml(version.id)}</div>
        <div class="ver-loader">${escapeHtml(subtitle)}${
          installed ? `<span class="ver-state"> · ${escapeHtml(t('ver.installed'))}</span>` : ''
        }</div>
      </div>
      <span class="ver-dot"></span>
    `;
    list.appendChild(row);
  });
}

function renderVanillaVersionSelect() {
  const select = $('#vanillaVersionSelect');
  select.innerHTML = '';
  versions.forEach((version) => select.appendChild(new Option(version.id, version.id)));
  select.value = cfg.vanillaVersion || PREVIEW_CFG.vanillaVersion;
}

function activeVersion() {
  return cfg.vanillaVersion;
}

function currentLoaderId() {
  return cfg.vanillaLoaderId;
}

function setCurrentLoaderId(loaderId) {
  cfg.vanillaLoaderId = loaderId;
}

function parseLoaderId(loaderId) {
  if (!loaderId) return null;
  if (loaderId.startsWith('vanilla:')) {
    const version = loaderId.substring('vanilla:'.length);
    return loaderObject('vanilla', version, version, '', true);
  }
  const idx = loaderId.indexOf(':');
  const at = loaderId.lastIndexOf('@');
  if (idx < 0 || at < 0) return null;
  const familyKey = loaderId.substring(0, idx);
  const build = loaderId.substring(idx + 1, at);
  const mcVersion = loaderId.substring(at + 1);
  return loaderObject(familyKey, mcVersion, build, '', false);
}

function activeLoader() {
  return parseLoaderId(currentLoaderId()) || loaderObject('fabric', '1.21.4', '0.16.10', '', true);
}

async function availableLoaders(versionId) {
  const cacheKey = versionId;
  if (dynamicLoaderCache.has(cacheKey)) return dynamicLoaderCache.get(cacheKey);
  if (IS_FILE_PREVIEW) {
    const preview = PREVIEW_LOADER_CATALOG[versionId] || [loaderObject('vanilla', versionId, versionId, '', true)];
    dynamicLoaderCache.set(cacheKey, preview);
    return preview;
  }
  try {
    const data = await fetchJson(`/api/catalog/loaders?version=${encodeURIComponent(versionId)}`);
    const list = data.loaders?.length ? data.loaders : [loaderObject('vanilla', versionId, versionId, '', true)];
    dynamicLoaderCache.set(cacheKey, list);
    return list;
  } catch {
    const fallback = PREVIEW_LOADER_CATALOG[versionId] || [loaderObject('vanilla', versionId, versionId, '', true)];
    dynamicLoaderCache.set(cacheKey, fallback);
    return fallback;
  }
}

async function ensureActiveLoader() {
  const loaders = await availableLoaders(activeVersion());
  const current = parseLoaderId(currentLoaderId());
  const exactExists = loaders.some((loader) => loader.id === currentLoaderId());
  if (!exactExists) {
    // Keep the user's chosen loader FAMILY (e.g. NeoForge) even if the exact build
    // changed or the catalog was refreshed — never silently drop it to Vanilla.
    const sameFamily = current && loaders.find((l) => l.familyKey === current.familyKey);
    if (sameFamily) {
      setCurrentLoaderId(sameFamily.id);
    } else if (current && current.familyKey !== 'vanilla' && loaders.length <= 1) {
      // Catalog looks incomplete (only Vanilla ⇒ likely a transient fetch miss) —
      // respect the user's explicit non-vanilla choice instead of resetting.
      /* keep currentLoaderId as-is */
    } else {
      setCurrentLoaderId(loaders[0]?.id || `vanilla:${activeVersion()}`);
    }
  }
  await updateVersionDependentUi();
}

function defaultLoaderFor(versionId, loaders) {
  /* Собранное важнее «рекомендованного». Каталог предлагает самую свежую
     сборку семьи, и по умолчанию выбор падал на неё — то есть на новую
     загрузку поверх уже готовой. Ваниллу сюда не пускаем: она «собрана»
     у любой скачанной версии и перебивала бы выбор загрузчика всегда. */
  const built = loaders?.find((loader) => loader.installed && loader.familyKey !== 'vanilla');
  return built?.id
    || loaders?.find((loader) => loader.recommended)?.id
    || loaders?.[0]?.id
    || `vanilla:${versionId}`;
}

async function syncSelectedVersion(versionId, save) {
  cfg.vanillaVersion = versionId;
  // Рисуем сразу: подсветка выбора обязана отзываться на клик мгновенно,
  // а не после похода в сеть за списком загрузчиков. Ниже список
  // перерисовывается ещё раз — уже с настоящим именем загрузчика,
  // которое до ответа сервера неизвестно.
  renderVersionList();
  const loaders = await availableLoaders(versionId);
  cfg.vanillaLoaderId = defaultLoaderFor(versionId, loaders);
  renderVersionList();
  await updateVersionDependentUi();
  await loadMods();
  await loadBrowserMods($('#modsSearch')?.value || '');
  if (save) saveSettings();
}

async function syncVanillaVersion(versionId) {
  await syncSelectedVersion(versionId, true);
}

async function updateVersionDependentUi() {
  const versionId = activeVersion();
  const selectedLoader = activeLoader();
  const family = selectedLoader.family;
  $('#brandVersion').textContent = `${versionId} - ${family}`;
  $('#selectedVersionLabel').textContent = versionId;
  $('#selectedLoaderVersionLabel').textContent = selectedLoader.label;
  $('#loaderLabel').textContent = family;
  $('#loaderSubtext').textContent = `${selectedLoader.label} - ${versionId}`;
  $('#selectedModeLabel').textContent = LAUNCHER_NAME;
  $('#musicFolderLabel').textContent = t('music.folderPath', { path: cfg.paths.music });
  $('#brandVersion').textContent = `${versionId} - ${selectedLoader.family}`;
  await renderLoaderDrawer();
  await renderInlineLoaderList();
  renderVersionList();
  renderBrowserMods(browserMods);
  highlightCompatibleMods();
}

async function renderLoaderDrawer() {
  const drawer = $('#loaderDrawer');
  drawer.innerHTML = '';
  const versionId = activeVersion();
  const loaders = await availableLoaders(versionId);
  loaders.forEach((loader, index) => {
    const button = document.createElement('button');
    button.className = `loader-option${currentLoaderId() === loader.id ? ' active' : ''}${loader.installed ? ' installed' : ''}`;
    button.innerHTML = `
      <strong>${escapeHtml(loader.family)}</strong>
      <span>${escapeHtml(loader.build)}${loader.channel ? ` - ${escapeHtml(loader.channel)}` : ''}${loader.recommended || index === 0 ? ' - preferred' : ''}${loader.installed ? ` · ${escapeHtml(t('ver.installed'))}` : ''}</span>
    `;
    button.onclick = () => selectLoader(loader.id);
    drawer.appendChild(button);
  });
}

async function renderInlineLoaderList() {
  const host = $('#inlineLoaderList');
  host.innerHTML = '';
  const loaders = await availableLoaders(activeVersion());
  loaders.forEach((loader) => {
    const button = document.createElement('button');
    button.className = `inline-loader-chip${currentLoaderId() === loader.id ? ' active' : ''}${loader.installed ? ' installed' : ''}`;
    button.textContent = loader.label;
    // Подписи в чипе нет места — «собрана» говорит наведение, а цвет чипа
    // виден и без него.
    button.title = loader.installed ? t('ver.installed') : t('ver.notInstalled');
    button.onclick = () => selectLoader(loader.id);
    host.appendChild(button);
  });
}

function toggleLoaderDrawer() {
  $('#loaderDrawer').classList.toggle('open');
}

async function selectLoader(loaderId) {
  setCurrentLoaderId(loaderId);
  await updateVersionDependentUi();
  await loadBrowserMods($('#modsSearch')?.value || '');
  await saveSettings();
}

const VANILLA_PLAY_VIDEOS = [
  VIDEO_BASE + 'minecrat_play.mp4'
];
const VANILLA_MODS_VIDEOS = [
  VIDEO_BASE + 'minecraft_mods.mp4'
];
const VANILLA_SETTINGS_VIDEOS = [
  VIDEO_BASE + 'minecraft_settings.mp4',
  VIDEO_BASE + 'minecrat_play.mp4'
];

/** Наборы фонов для оформления: по одному на вкладку. */
function videoSetsFor(theme) {
  return theme === 'vulkan'
    ? { play: PLAY_VIDEO_CANDIDATES, mods: MODS_VIDEO_CANDIDATES, settings: SETTINGS_VIDEO_CANDIDATES }
    : { play: VANILLA_PLAY_VIDEOS, mods: VANILLA_MODS_VIDEOS, settings: VANILLA_SETTINGS_VIDEOS };
}

// True crossfade: the incoming background plays on a top layer (#bgFade) and fades
// in OVER the current one, then we commit it to the base layers — both are visible
// mid-transition, so one background melts into the next with no black dip.
//
// Switches are QUEUED, never run in parallel. Flipping modes quickly used to leave an
// older fade still in flight: it finished after the newer request and committed its
// stale sources to the base layers, so the cheat background ended up on screen in
// vanilla mode. Now only the newest request survives — the running fade either bails
// out before it is ever shown, or completes and the latest pending one runs after.
let _videoFadeBusy = false;
let _pendingVideo = null;

async function switchVideoWithCrossfade(sets) {
  _pendingVideo = sets;
  if (_videoFadeBusy) return;          // the running loop will pick up the newest request

  _videoFadeBusy = true;
  try {
    while (_pendingVideo) {
      const job = _pendingVideo;
      _pendingVideo = null;
      await runVideoCrossfade(job);
    }
  } finally {
    _videoFadeBusy = false;
    // A request that landed between the loop's check and the flag reset
    if (_pendingVideo) void switchVideoWithCrossfade(_pendingVideo);
  }
}

async function runVideoCrossfade(sets) {
  const fade = $('#bgFade');
  if (!fade) {
    bindVideoCandidates($('#bgPlay'), sets.play);
    bindVideoCandidates($('#bgMods'), sets.mods);
    bindVideoCandidates($('#bgSettings'), sets.settings);
    return;
  }

  // Which base layer is currently shown (each tab has its own background)
  const targetCandidates = sets[currentTab] || sets.play;

  // Load the incoming video onto the fade layer and start playing it.
  // Решение «играть» ставим до привязки: слой перехода по умолчанию на паузе
  // (см. syncVideoPlayback), и без этого метка _pulseWanted запретила бы запуск
  // ровно в тот единственный момент, когда слой нужен.
  fade._pulseWanted = true;
  bindVideoCandidates(fade, targetCandidates);

  // Give it a beat to start decoding a frame. If a newer switch landed meanwhile,
  // drop this one before it is ever shown — the queue handles the rest.
  await new Promise(r => setTimeout(r, 40));
  if (_pendingVideo) return;

  fade.classList.add('show');
  await new Promise(r => setTimeout(r, 300)); // matches CSS .28s + small buffer

  // Commit the new sources to the base layers underneath, then hide the fade layer.
  bindVideoCandidates($('#bgPlay'), sets.play);
  bindVideoCandidates($('#bgMods'), sets.mods);
  bindVideoCandidates($('#bgSettings'), sets.settings);
  // Переход мог застать падение вкладки: тогда один из слоёв уехал вниз и
  // остался там. Возвращаем раскладку вкладок, иначе нужный фон не покажется.
  applyTabBackgrounds(currentTab);
  await new Promise(r => setTimeout(r, 20));
  fade.classList.remove('show');
  syncVideoPlayback();   // слой кроссфейда больше не нужен — ставим на паузу
}

function setTheme(theme, persist = true) {
  currentTheme = theme;
  cfg.lastTheme = theme;
  document.body.classList.toggle('theme-vanilla', theme === 'vanilla');
  $('#themeVulkanBtn').classList.toggle('active', theme === 'vulkan');
  $('#themeVanillaBtn').classList.toggle('active', theme === 'vanilla');

  // Фоновые ролики — часть оформления, поэтому меняются вместе с ним.
  // Явная смена темы идёт с плавным переходом, первая отрисовка — без него.
  const sets = videoSetsFor(theme);
  if (persist) {
    switchVideoWithCrossfade(sets);
  } else {
    bindVideoCandidates($('#bgPlay'), sets.play);
    bindVideoCandidates($('#bgMods'), sets.mods);
    bindVideoCandidates($('#bgSettings'), sets.settings);
    applyTabBackgrounds(currentTab);
    syncVideoPlayback();
  }

  $('#heroBadge').textContent = t('hero.badge');
  $('#heroTitle').textContent = t('hero.title');
  $('#heroText').textContent = t('hero.text', { name: LAUNCHER_NAME });
  $('#launchBtnLabel').textContent = t('hero.launch');

  // Заголовок окна и иконка в панели задач тоже оформление: фиолетовая небула
  // у vulkan, зелёный луг у Vanilla.
  if (window.pulse && typeof window.pulse.setTitle === 'function') {
    window.pulse.setTitle(`${LAUNCHER_NAME} launcher`);
  }
  if (window.pulse && typeof window.pulse.setMode === 'function') {
    window.pulse.setMode(theme);
  }

  if (persist) saveSettings();
  refreshFxObstacles();   // у тем разные препятствия: часть блоков появляется, часть исчезает
  // Полоска в сайдбаре и фон на кнопках меняют вид вместе с темой
  if (window.FX && typeof window.FX.refreshMode === 'function') window.FX.refreshMode();
}

// Ярлык может открыть лаунчер сразу в нужном оформлении: --mode=vanilla
// превращается в ?mode=vanilla в адресе. Применяется без плавного перехода,
// чтобы первая отрисовка не анимировалась.
function applyInitialThemeFromUrl() {
  const requested = new URLSearchParams(location.search).get('mode');
  if (requested !== 'vanilla' && requested !== 'vulkan') return;
  if (requested === currentTheme) return;
  setTheme(requested, false);
  saveSettings();
}

// Скрытое видео продолжает декодироваться: opacity:0 его не останавливает.
// Два ролика 1080p60, крутящиеся вхолостую, — заметная нагрузка на слабой машине,
// поэтому всё невидимое ставим на паузу, а нужное возвращаем к жизни.
//
// Играет видео или нет, решает только эта функция: она же запоминает решение в
// _pulseWanted, и по нему запускается ролик, когда догрузится (см. onLoaded).
// Порознь эти два места не работают: ролик грузится не мгновенно, и запуск по
// факту загрузки возвращал к жизни ровно то, что здесь только что остановили —
// так второй ролик 1080p и крутился вхолостую, пока игра шла.
let windowFocused = true;

// Простой. Если игрок тридцать секунд не трогал мышь, клавиатуру и колесо,
// фоновый ролик встаёт на паузу. Это самый дорогой элемент интерфейса —
// замерено 42–47 % ядра, — и платится он за кадр, а не за пиксель: стоящий
// ролик не стоит ничего. Холсты (волна, пружина, диорама) гасятся по тому же
// признаку своим таймером в effects.js; здесь тот же порог для видео.
//
// Фон при этом не гаснет и не подменяется — на экране остаётся тот же кадр,
// на котором игрока оставили. Возвращается всё с первой же активности: и
// мышь, и клавиша, и колесо.
const IDLE_AFTER_MS = 30000;
let userIdle = false;
let _idleTimer = null;

function markActivity() {
  if (userIdle) {
    userIdle = false;
    syncVideoPlayback();
  }
  if (_idleTimer) clearTimeout(_idleTimer);
  _idleTimer = setTimeout(() => {
    userIdle = true;
    syncVideoPlayback();
  }, IDLE_AFTER_MS);
}

function watchIdle() {
  ['pointermove', 'pointerdown', 'keydown', 'wheel'].forEach((event) => {
    window.addEventListener(event, markActivity, { passive: true });
  });
  markActivity();
}

function syncVideoPlayback() {
  const onScreen = !document.hidden && windowFocused && !userIdle;
  const bgPlay = $('#bgPlay');
  const bgMods = $('#bgMods');
  const bgSettings = $('#bgSettings');
  const fade = $('#bgFade');
  // Уехавший вверх слой ещё виден, но уже растворяется: декодировать ему
  // нечего, он для зрителя уходит (см. leaving-up в style.css).
  const shown = (video) => !!video
    && !video.classList.contains('hidden')
    && !video.classList.contains('leaving-up');
  setVideoWanted(bgPlay, onScreen && shown(bgPlay));
  setVideoWanted(bgMods, onScreen && shown(bgMods));
  setVideoWanted(bgSettings, onScreen && shown(bgSettings));
  // Слой кроссфейда живёт только на время перехода, и переход этот начинается
  // от действия игрока — то есть при окне в фокусе. Поэтому фокус для него не
  // проверяем: иначе ролик не запустился бы в тот единственный момент, когда он
  // нужен.
  setVideoWanted(fade, !!fade?.classList.contains('show'));
}

/* ── Переход на «Настройки» ──
   Прежний фон уходит вверх и растворяется, новый проявляется из размытия — в
   конце на экране стоит фон настроек. Остальные переходы между вкладками
   остаются мгновенными. */
const BG_SWAP_MS = 700;
const TAB_BG = { play: '#bgPlay', mods: '#bgMods', settings: '#bgSettings' };
let _bgSwapTimer = null;

/* Снять переходные классы так, чтобы слой не поехал на место четыре секунды:
   у .bg переход transform растянут ради параллакса, и без запрета на переход
   возврат был бы виден как медленно выползающий фон. */
function dropSwapClasses(el) {
  el.classList.add('bg-no-transition');
  el.classList.remove('arriving', 'leaving-up');
  requestAnimationFrame(() => el.classList.remove('bg-no-transition'));
}

/** Оставить на экране фон одной вкладки, остальные спрятать. */
function setActiveBackground(tabName) {
  $('#bgPlay').classList.toggle('hidden', tabName !== 'play');
  $('#bgMods').classList.toggle('hidden', tabName !== 'mods');
  $('#bgSettings').classList.toggle('hidden', tabName !== 'settings');
}

/* Прервать переход и привести слои в порядок. Раскладку восстанавливаем тут же,
   а не оставляем таймеру: игрок может щёлкать по вкладкам быстрее, чем идёт
   переход, и отменённый таймер не спрятал бы слой — тогда фоны накладывались
   друг на друга, и поверх нужного оказывался чужой ролик. */
function resetBackgroundSwap(tabName) {
  if (_bgSwapTimer) { clearTimeout(_bgSwapTimer); _bgSwapTimer = null; }
  $$('.bg').forEach(dropSwapClasses);
  if (tabName) setActiveBackground(tabName);
}

/** Показать фон одной вкладки, без анимации. */
function applyTabBackgrounds(tabName) {
  resetBackgroundSwap(tabName);
}

function swapBackgroundToSettings(tabName, prevTab) {
  // Наплыв только у «Настроек»: между play и mods фон меняется мгновенно.
  if (tabName !== 'settings' && prevTab !== 'settings') return false;
  const next = $(TAB_BG[tabName]);
  const prev = $(TAB_BG[prevTab]);
  if (!next || !prev || next === prev) return false;
  // У вкладки нет своего ролика — смешивать нечего, лучше мгновенная подмена.
  if (next.classList.contains('is-missing')
      || prev.classList.contains('is-missing')) return false;

  // Прошлый переход (если он ещё шёл) закрываем сразу: на экране должен
  // остаться ровно тот фон, от которого начинаем.
  resetBackgroundSwap(prevTab);
  prev.classList.remove('hidden');
  next.classList.remove('hidden');
  syncVideoPlayback();          // оба слоя на экране — оба должны играть

  // Классы вешаем следующим кадром: снятый и навешенный в один тик класс не
  // считается сменой состояния, и повторный клик не перезапустил бы переход.
  requestAnimationFrame(() => {
    prev.classList.add('leaving-up');
    next.classList.add('arriving');
    _bgSwapTimer = setTimeout(() => {
      _bgSwapTimer = null;
      next.classList.remove('arriving');
      dropSwapClasses(prev);
      setActiveBackground(tabName);
      syncVideoPlayback();      // ушедший слой встал на паузу
    }, BG_SWAP_MS + 40);
  });
  return true;
}

function setVideoWanted(video, wanted) {
  if (!video) return;
  video._pulseWanted = wanted;
  if (wanted) {
    if (video.paused) video.play().catch(() => {});
  } else {
    video.pause();
  }
}

// Маска среды для волны строится из геометрии элементов. Интерфейс перерисовывается
// из JS, поэтому после заметных изменений просим эффекты пересобрать её — по событию,
// а не по таймеру: сбор масок дёргает getComputedStyle на каждом элементе.
function refreshFxObstacles() {
  if (window.FX && typeof window.FX.obstaclesChanged === 'function') window.FX.obstaclesChanged();
}

/* Координаты символов для эффекта рассыпания кэшируются, а смена вкладки
   прячет страницу: у скрытых символов прямоугольник нулевой, и они выпадают
   из кэша. Обратно они сами не вернутся — текст-то не менялся, — поэтому
   после переключения просим пересчитать раскладку заново. */
function refreshScramble() {
  if (window.Scramble && typeof window.Scramble.refresh === 'function') window.Scramble.refresh();
}

function switchTab(tabName, button) {
  const prevTab = currentTab;
  currentTab = tabName;
  $$('.page').forEach((page) => page.classList.remove('active'));
  $$('.nav-btn').forEach((item) => item.classList.remove('active'));
  $(`#page-${tabName}`).classList.add('active');
  button.classList.add('active');
  // У каждой вкладки свой фон. Переход с наплывом — только у «Настроек»;
  // между play и mods, при первом показе и при повторном клике по своей же
  // вкладке фон меняется мгновенно: смешивать нечего.
  if (tabName === prevTab || !swapBackgroundToSettings(tabName, prevTab)) {
    applyTabBackgrounds(tabName);
  }
  syncVideoPlayback();
  refreshFxObstacles();
  refreshScramble();
  if (tabName === 'mods') {
    loadMods();
    loadModCategories();
    loadBrowserMods($('#modsSearch')?.value || '');
  }
}

async function launchGame() {
  const version = activeVersion();
  const selectedLoader = activeLoader();
  appendLog(`Launch requested for ${PROFILE_MODE} ${version} (${selectedLoader.label})`);

  if (IS_FILE_PREVIEW) {
    $('#launchProgress').style.width = '100%';
    $('#launchStatus').textContent = `Preview launch: ${PROFILE_MODE} ${version} with ${selectedLoader.label}`;
    toast(`Preview launch: ${selectedLoader.label}`, 'ok');
    setTimeout(() => {
      $('#launchProgress').style.width = '0';
      $('#launchStatus').textContent = 'Ready';
    }, 1800);
    return;
  }

  const launchBtn = $('#launchBtn');
  if (launchBtn) launchBtn.disabled = true;
  $('#launchProgress').style.width = '2%';
  $('#launchStatus').textContent = t('launch.preparing');

  let pollingDone = false;
  let lastLoggedMessage = '';

  try {
    // 1. Send the launch request first. It returns immediately after the backend
    //    calls LaunchProgress.begin(), so polling afterwards can't read stale state.
    let result;
    if (window.pulse && typeof window.pulse.launchMinecraft === 'function') {
      result = await window.pulse.launchMinecraft({ version, mode: PROFILE_MODE, loaderId: selectedLoader.id });
    } else {
      result = await fetchJson('/api/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version, mode: PROFILE_MODE, loaderId: selectedLoader.id })
      });
    }
    if (result && result.ok === false) throw new Error(result.error || 'Launch failed');

    // 2. Poll real progress until the game starts (or an error is reported),
    //    mirroring each new message into the log so launch info is visible again.
    while (!pollingDone) {
      await new Promise(r => setTimeout(r, 350));
      let p;
      try { p = await fetchJson('/api/launch/progress'); }
      catch (_) { continue; } // backend momentarily busy — keep polling
      if (!p || typeof p.percent !== 'number') continue;

      $('#launchProgress').style.width = Math.max(2, p.percent) + '%';
      $('#launchStatus').textContent = p.message || '...';
      if (p.message && p.message !== lastLoggedMessage) {
        appendLog(p.message);
        lastLoggedMessage = p.message;
      }
      if (p.error) throw new Error(p.message || t('launch.failed'));
      if (p.stage === 'running') { pollingDone = true; break; }
    }

    $('#launchProgress').style.width = '100%';
    $('#launchStatus').textContent = t('launch.started');
    appendLog(t('launch.startedWith', { loader: selectedLoader.label }));
    toast(t('launch.toastStarted'), 'ok');
    setTimeout(() => {
      $('#launchProgress').style.width = '0';
      $('#launchStatus').textContent = 'Ready';
    }, 3500);
  } catch (error) {
    pollingDone = true;
    $('#launchProgress').style.width = '0';
    $('#launchStatus').textContent = t('launch.failed');
    appendLog(t('launch.failedDetail', { message: error.message }));
    toast(t('common.error', { message: error.message }), 'err');
  } finally {
    pollingDone = true;
    if (launchBtn) launchBtn.disabled = false;
    /* Версия к этому моменту уже лежит на диске — и когда игра запустилась,
       и когда сорвалась на середине. Перечитываем список, чтобы она перестала
       значиться как «не скачана»: пометка должна отвечать тому, что на диске,
       а не тому, что было при открытии окна. */
    loadVersions();
  }
}

function toggleLog() {
  const box = $('#logbox');
  box.classList.toggle('open');
  $('#logToggle').textContent = box.classList.contains('open') ? 'Hide log' : 'Show log';
}

function appendLog(message) {
  const box = $('#logbox');
  const now = new Date().toLocaleTimeString();
  box.textContent += `[${now}] ${message}\n`;
}

async function loadMods() {
  if (IS_FILE_PREVIEW) {
    mods = PREVIEW_MODS.map((mod) => ({ ...mod }));
    renderMods();
    return;
  }
  try {
    const data = await fetchJson(`/api/mods?mode=${encodeURIComponent(PROFILE_MODE)}`);
    mods = (data.mods || []).map((mod) => ({ ...mod }));
  } catch {
    mods = PREVIEW_MODS.map((mod) => ({ ...mod }));
  }
  renderMods();
}

const MODS_PAGE = 12;         // сколько модов приходит за один запрос

/* Выбранные группы. Пусто — фильтра нет, показываем всё подряд. */
let modCategories = new Set();
let modsOffset = 0;
let modsExhausted = false;    // источник отдал меньше страницы — дальше пусто

function catalogUrl(query, offset) {
  const loaderKey = activeLoader().familyKey;
  return `/api/catalog/mods?version=${encodeURIComponent(activeVersion())}`
    + `&loader=${encodeURIComponent(loaderKey)}`
    + `&query=${encodeURIComponent(query)}`
    + `&limit=${MODS_PAGE}&offset=${offset}`
    + `&source=${encodeURIComponent(cfg.modSource || 'modrinth')}`
    + `&categories=${encodeURIComponent([...modCategories].join(','))}`;
}

function previewBrowserMods(query) {
  const versionId = activeVersion();
  return PREVIEW_BROWSER_MODS
    .filter((mod) => mod.versions.includes(versionId) && mod.loaders.includes(activeLoader().family))
    .filter((mod) => !query.trim() || `${mod.name} ${mod.author} ${mod.desc}`.toLowerCase().includes(query.trim().toLowerCase()));
}

async function loadBrowserMods(query) {
  const cacheKey = `${cfg.modSource || 'modrinth'}|${activeVersion()}|${query.trim().toLowerCase()}|${[...modCategories].sort().join(',')}`;
  modsOffset = 0;
  modsExhausted = false;

  if (dynamicModsCache.has(cacheKey)) {
    browserMods = dynamicModsCache.get(cacheKey);
    modsOffset = browserMods.length;
    renderBrowserMods(browserMods);
    return;
  }
  if (IS_FILE_PREVIEW) {
    browserMods = previewBrowserMods(query);
    dynamicModsCache.set(cacheKey, browserMods);
    renderBrowserMods(browserMods);
    return;
  }
  try {
    const data = await fetchJson(catalogUrl(query, 0));
    browserMods = data.results || [];
    dynamicModsCache.set(cacheKey, browserMods);
    modsOffset = browserMods.length;
    modsExhausted = browserMods.length < MODS_PAGE;
  } catch {
    browserMods = previewBrowserMods(query);
  }
  renderBrowserMods(browserMods);
  syncLoadMore();
}

/* Догрузка следующей порции. Дописываем в конец, а не перерисовываем список:
   иначе слетела бы позиция прокрутки. */
async function loadMoreMods() {
  if (modsExhausted || IS_FILE_PREVIEW) return;
  const btn = $('#loadMoreMods');
  const query = $('#modsSearch') ? $('#modsSearch').value : '';
  if (btn) { btn.disabled = true; btn.textContent = t('common.loading'); }
  try {
    const data = await fetchJson(catalogUrl(query, modsOffset));
    const page = data.results || [];
    if (!page.length) {
      modsExhausted = true;
    } else {
      browserMods = browserMods.concat(page);
      modsOffset += page.length;
      modsExhausted = page.length < MODS_PAGE;
      const cacheKey = `${cfg.modSource || 'modrinth'}|${activeVersion()}|${query.trim().toLowerCase()}|${[...modCategories].sort().join(',')}`;
      dynamicModsCache.set(cacheKey, browserMods);
      renderBrowserMods(browserMods);
    }
  } catch (error) {
    toast(t('mods.loadMoreFailed', { message: error.message }), 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = t('mods.showMore'); }
    syncLoadMore();
  }
}

function syncLoadMore() {
  const btn = $('#loadMoreMods');
  if (!btn) return;
  btn.hidden = modsExhausted || IS_FILE_PREVIEW;
}

/* ── Группы модов ─────────────────────────────────────────────────────────────
   Список групп один на оба источника и приходит с бэкенда: у Modrinth
   категории текстовые, у CurseForge числовые, и сводить их на лету значило бы
   показывать разные чипы при переключении источника. */
async function loadModCategories() {
  const host = $('#modCategories');
  if (!host || host.childElementCount) return;
  let list = [];
  try {
    const data = await fetchJson('/api/catalog/categories');
    list = data.categories || [];
  } catch {
    return;   // без групп каталог всё равно работает
  }
  host.textContent = '';
  for (const cat of list) {
    const chip = document.createElement('button');
    chip.className = 'cat-chip';
    chip.dataset.id = cat.id;
    chip.textContent = cat.label;
    chip.onclick = () => toggleModCategory(cat.id);
    host.appendChild(chip);
  }
}

function toggleModCategory(id) {
  if (modCategories.has(id)) modCategories.delete(id);
  else modCategories.add(id);
  $$('#modCategories .cat-chip').forEach((chip) => {
    chip.classList.toggle('active', modCategories.has(chip.dataset.id));
  });
  loadBrowserMods($('#modsSearch') ? $('#modsSearch').value : '');
}

function renderBrowserMods(items) {
  const host = $('#browserModsList');
  if (!host) return;
  const versionId = activeVersion();
  const loader = activeLoader();
  host.innerHTML = '';

  if (!items.length) {
    host.innerHTML = `<div class="browser-empty">No compatible mods found for ${escapeHtml(versionId)} / ${escapeHtml(loader.family)}.</div>`;
    return;
  }

  items.forEach((mod) => {
    const modLoaders = mod.loaders || [];
    const modVersions = mod.versions || [];
    const compatibleVersion = modVersions.includes(versionId);
    const compatibleLoader = modLoaders.includes(loader.family);
    const row = document.createElement('div');
    row.className = `browser-mod-row${compatibleVersion && compatibleLoader ? '' : ' incompatible'}`;
    const iconHtml = mod.iconUrl
      ? `<img class="browser-mod-icon" src="${escapeHtml(mod.iconSmall || mod.iconUrl)}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
      : '';
    const letterHtml = `<div class="browser-mod-icon-letter" style="${mod.iconUrl ? 'display:none' : ''}">${escapeHtml(mod.name.charAt(0).toUpperCase())}</div>`;
    row.innerHTML = `
      <div class="browser-mod-icon-wrap">${iconHtml}${letterHtml}</div>
      <div class="browser-mod-left">
        <div class="browser-mod-name">${escapeHtml(mod.name)}</div>
        <div class="browser-mod-meta">${escapeHtml(mod.author || 'Unknown')} · ${escapeHtml(mod.desc || '')}</div>
        <div class="browser-mod-tags">
          <span class="flag info">${escapeHtml(modLoaders.join(', ') || loader.family)}</span>
          <span class="flag ${compatibleVersion && compatibleLoader ? 'ok' : 'bad'}">${compatibleVersion && compatibleLoader ? 'compatible' : 'not compatible'}</span>
          ${mod.downloads ? `<span class="flag info">${formatDownloads(mod.downloads)} ↓</span>` : ''}
        </div>
        <div class="browser-mod-versions">${escapeHtml(modVersions.slice(0, 8).join(', '))}${modVersions.length > 8 ? ' …' : ''}</div>
      </div>
      <div class="browser-mod-actions">
        <button class="ghost-btn browser-install-btn">${compatibleVersion && compatibleLoader ? 'Install' : 'Blocked'}</button>
        ${mod.url ? `<a class="browser-link" href="${escapeHtml(mod.url)}" target="_blank" rel="noreferrer">Modrinth ↗</a>` : ''}
      </div>
    `;
    row.querySelector('button').onclick = async () => {
      if (!(compatibleVersion && compatibleLoader)) {
        toast(`${mod.name} is not compatible with ${versionId} / ${loader.family}`, 'err');
        return;
      }
      if (IS_FILE_PREVIEW) {
        toast(`Preview: would install ${mod.name}`, 'ok');
        return;
      }
      const btn = row.querySelector('button');
      btn.disabled = true;
      btn.textContent = 'Installing...';
      try {
        const result = await fetchJson('/api/mods/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Include mode so the server stores the mod in the correct profile folder
          body: JSON.stringify({ slug: mod.slug, mcVersion: versionId, loader: loader.familyKey, mode: PROFILE_MODE })
        });
        if (result && result.ok === false) throw new Error(result.error || 'Install failed');
        btn.textContent = 'Installed';
        toast(`${mod.name} installed`, 'ok');
        await loadMods();
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Install';
        toast(`Install failed: ${e.message}`, 'err');
      }
    };
    // Clicking anywhere on the row (except the install button / Modrinth link)
    // opens the full description panel — works for catalog mods too, not just installed.
    row.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('a')) return;
      showModDetail({
        name: mod.name,
        icon: (mod.name || '?').charAt(0).toUpperCase(),
        iconUrl: mod.iconUrl || mod.iconSmall || '',
        slug: mod.slug || '',
        source: mod.source || cfg.modSource || 'modrinth',
        meta: `${mod.author || 'Unknown'} · ${compatibleVersion && compatibleLoader ? t('mods.compatible') : t('mods.incompatible')}${mod.downloads ? ' · ' + formatDownloads(mod.downloads) + ' ↓' : ''}`,
        desc: mod.desc && mod.desc.trim() ? mod.desc : t('mods.noDescription'),
        flags: [
          { text: modLoaders.join(', ') || loader.family, kind: 'info' },
          { text: compatibleVersion && compatibleLoader ? 'compatible' : 'not compatible', kind: compatibleVersion && compatibleLoader ? 'ok' : 'bad' },
          ...(modVersions.length ? [{ text: t('mods.versionsInline', { list: modVersions.slice(0, 6).join(', ') + (modVersions.length > 6 ? ' …' : '') }), kind: 'info' }] : [])
        ],
        toggleLabel: null,
        url: mod.url || null
      });
      // Кнопку берём именно этой вкладки: с общей первой кнопкой подсветка
      // оставалась на Play, пока открыт Mods.
      switchTab('mods', document.querySelector('.nav-btn[onclick*="mods"]'));
    });
    host.appendChild(row);
  });
}

function renderMods() {
  const activeList = $('#modsList');
  const downloadedList = $('#downloadedModsList');
  activeList.innerHTML = '';
  downloadedList.innerHTML = '';
  mods.filter((mod) => !mod.downloaded).forEach((mod) => activeList.appendChild(buildModRow(mod)));
  mods.filter((mod) => mod.downloaded).forEach((mod) => downloadedList.appendChild(buildModRow(mod)));
  if ((!selectedMod || !mods.find((mod) => mod.fileName === selectedMod.fileName)) && mods.length) {
    selectMod(mods[0]);
  }
}

function buildModRow(mod) {
  const row = document.createElement('button');
  row.className = 'mod-row';
  row.dataset.name = mod.fileName;
  row.onclick = () => selectMod(mod);
  row.innerHTML = `
    <div class="mod-bullet">${escapeHtml(mod.name.charAt(0).toUpperCase())}</div>
    <div class="mod-main">
      <div class="mod-name">${escapeHtml(mod.name)}</div>
      <div class="mod-sub">${escapeHtml(mod.version || '?')} - ${escapeHtml(mod.fileName)}</div>
    </div>
    <div class="mod-flags">${modFlags(mod).map((flag) => `<span class="flag ${flag.kind}">${flag.text}</span>`).join('')}</div>
  `;
  if (selectedMod && selectedMod.fileName === mod.fileName) row.classList.add('active');
  return row;
}

function modFlags(mod) {
  const flags = [];
  if (mod.downloaded) flags.push({ text: t('mods.flagDownloaded'), kind: 'info' });
  else if (mod.enabled) flags.push({ text: t('mods.flagEnabled'), kind: 'ok' });
  else flags.push({ text: t('mods.flagDisabled'), kind: 'warn' });
  if (typeof mod.compatible === 'boolean') {
    flags.push({ text: mod.compatible ? 'compatible' : 'incompatible', kind: mod.compatible ? 'ok' : 'bad' });
  }
  if (mod.latestKnownVersion) flags.push({ text: t('mods.latestVersion', { version: mod.latestKnownVersion }), kind: 'info' });
  return flags;
}

function selectMod(mod) {
  selectedMod = mod;
  $$('.mod-row').forEach((row) => row.classList.remove('active'));
  $$(`[data-name="${cssEscape(mod.fileName)}"]`).forEach((row) => row.classList.add('active'));
  showModDetail({
    name: mod.name,
    icon: mod.name.charAt(0).toUpperCase(),
    meta: `${mod.version || '?'} - ${mod.compatible ? 'compatible' : 'incompatible'} - ${mod.enabled ? 'enabled' : mod.downloaded ? 'downloaded only' : 'disabled'}`,
    desc: mod.desc && mod.desc.trim() ? mod.desc : t('mods.currentTarget', { version: activeVersion(), loader: activeLoader().label }),
    flags: modFlags(mod),
    toggleLabel: t('mods.toggle'),
    url: null
  });
}

// Populate + reveal the mod detail panel. Used by both installed and catalog mods.
/* Какой мод сейчас в панели. Нужен, чтобы ответы сети, пришедшие с
   опозданием, не переписывали описание уже другого мода. */
let currentDetail = null;

function showModDetail(info) {
  const panel = $('#modDetail');
  if (!panel) return;

  /* Иконка. Раньше здесь всегда стояла первая буква названия, хотя ссылка на
     иконку приходила из каталога вместе со всем остальным. */
  const iconHost = $('#detailIcon');
  iconHost.textContent = '';
  if (info.iconUrl) {
    const img = document.createElement('img');
    img.src = info.iconUrl;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    // Картинка не доехала — возвращаем букву: панель не должна пустовать
    img.onerror = () => { iconHost.textContent = (info.name || '?').charAt(0).toUpperCase(); };
    iconHost.appendChild(img);
  } else {
    iconHost.textContent = info.icon || (info.name || '?').charAt(0).toUpperCase();
  }

  $('#detailName').textContent = info.name || '';
  $('#detailMeta').textContent = info.meta || '';
  $('#detailFlags').innerHTML = (info.flags || [])
    .map((f) => `<span class="flag ${escapeHtml(f.kind)}">${escapeHtml(f.text)}</span>`).join('');

  /* Описание показываем коротким сразу, полное подтягиваем следом. Так панель
     не пустует, пока идёт запрос, и остаётся осмысленной, если он не удался. */
  $('#detailDesc').textContent = info.desc || t('mods.noDescription');
  currentDetail = {
    slug: info.slug || '',
    source: info.source || cfg.modSource || 'modrinth',
    url: info.url || '',
    seq: (currentDetail ? currentDetail.seq : 0) + 1
  };

  // Список версий при смене мода всегда сворачиваем: он относится к прошлому
  const versions = $('#detailVersions');
  if (versions) { versions.dataset.open = 'false'; versions.textContent = ''; }
  const versionsBtn = $('#detailVersionsBtn');
  if (versionsBtn) versionsBtn.hidden = !currentDetail.slug;

  const toggleBtn = $('#toggleSelectedModBtn');
  if (toggleBtn) {
    if (info.toggleLabel) { toggleBtn.style.display = ''; toggleBtn.textContent = info.toggleLabel; }
    else toggleBtn.style.display = 'none';
  }

  let linkEl = $('#detailModLink');
  if (info.url) {
    if (!linkEl) {
      linkEl = document.createElement('a');
      linkEl.id = 'detailModLink';
      linkEl.className = 'browser-link';
      linkEl.target = '_blank'; linkEl.rel = 'noreferrer';
      $('#detailFlags').insertAdjacentElement('beforebegin', linkEl);
    }
    linkEl.href = info.url;
    linkEl.textContent = currentDetail.source === 'curseforge'
      ? t('mods.openCurseforge') : t('mods.openModrinth');
    linkEl.style.display = '';
  } else if (linkEl) {
    linkEl.style.display = 'none';
  }

  panel.setAttribute('data-open', 'true');
  panel.classList.add('detail-open');
  const scrim = $('#detailScrim');
  if (scrim) scrim.classList.add('open');
  replayStagger($('#detailStagger'));
  refreshFxObstacles();   // панель только что легла поверх списка

  loadFullDescription(currentDetail);
}

/* Полное описание проекта: у Modrinth это markdown, у CurseForge — html.
   Разбирает js/richtext.js — узлами DOM, потому что текст чужой. */
async function loadFullDescription(detail) {
  if (!detail || !detail.slug || IS_FILE_PREVIEW) return;
  try {
    const data = await fetchJson(`/api/catalog/project?source=${encodeURIComponent(detail.source)}`
      + `&slug=${encodeURIComponent(detail.slug)}`);
    // Пока ходили — могли выбрать другой мод. Тогда ответ уже не нужен.
    if (currentDetail !== detail) return;
    const project = data && data.project;
    if (!project || !project.body) return;

    window.RichText.renderInto($('#detailDesc'), project.body, project.format);

    /* Волна появления. Блоки описания помечены data-t-words — разбор идёт по
       словам, а не по буквам: замерено, что тысяча анимированных символов
       роняет 40% кадров, а те же слова идут ровно как пустая страница. */
    if (window.TextReveal) {
      $('#detailDesc').querySelectorAll('[data-t-chars], [data-t-words]')
        .forEach((el) => window.TextReveal.build(el));
    }
  } catch (error) {
    // Не беда: короткое описание из каталога уже на экране
    console.warn('[vulkan] полное описание не получено:', error.message);
  }
}

/* Список версий. Свёрнут, пока его не попросят: раскрытые сорок версий
   заслоняют описание, ради которого панель и открывали. */
async function toggleDetailVersions() {
  const host = $('#detailVersions');
  if (!host) return;
  if (host.dataset.open === 'true') { host.dataset.open = 'false'; return; }
  if (host.childElementCount) { host.dataset.open = 'true'; return; }

  host.dataset.open = 'true';
  host.textContent = t('mods.loadingVersions');
  const detail = currentDetail;
  try {
    const data = await fetchJson(`/api/catalog/versions?source=${encodeURIComponent(detail.source)}`
      + `&slug=${encodeURIComponent(detail.slug)}`
      + `&version=${encodeURIComponent(activeVersion())}`
      + `&loader=${encodeURIComponent(activeLoader().familyKey)}`);
    if (currentDetail !== detail) return;
    renderDetailVersions(data.versions || []);
  } catch (error) {
    host.textContent = t('mods.versionsFailed', { message: error.message });
  }
}

const RELEASE_LABEL = { 1: 'release', 2: 'beta', 3: 'alpha' };

function renderDetailVersions(list) {
  const host = $('#detailVersions');
  host.textContent = '';
  if (!list.length) {
    host.textContent = t('mods.noVersions', { version: activeVersion(), loader: activeLoader().family });
    return;
  }

  for (const version of list) {
    const row = document.createElement('div');
    row.className = 'version-row';

    const left = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'version-name';
    name.textContent = version.name || version.fileName || t('mods.untitled');

    const meta = document.createElement('div');
    meta.className = 'version-meta';
    meta.textContent = [
      RELEASE_LABEL[version.releaseType] || '',
      (version.gameVersions || []).slice(0, 4).join(', '),
      version.date ? version.date.slice(0, 10) : '',
      version.downloads ? `${formatDownloads(version.downloads)} ↓` : ''
    ].filter(Boolean).join(' · ');
    left.append(name, meta);

    const btn = document.createElement('button');
    btn.className = 'version-dl';
    btn.textContent = t('mods.download');
    btn.disabled = !version.downloadUrl;
    if (!version.downloadUrl) btn.title = t('mods.noDirectLinkApi');
    btn.onclick = () => installModVersion(version, btn);

    row.append(left, btn);
    host.appendChild(row);
  }
}

/* Установка конкретной версии. Ссылка и имя файла уже пришли из списка, а он
   одинаков для обоих источников, поэтому дорога на бэкенде одна. */
async function installModVersion(version, btn) {
  if (!version.downloadUrl) {
    toast(t('mods.noDirectLinkManual'), 'err');
    return;
  }
  if (IS_FILE_PREVIEW) { toast(`Preview: скачал бы ${version.fileName}`, 'ok'); return; }

  const was = btn.textContent;
  btn.disabled = true;
  btn.textContent = t('mods.downloading');
  try {
    const result = await fetchJson('/api/mods/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        downloadUrl: version.downloadUrl,
        fileName: version.fileName,
        mcVersion: activeVersion(),
        loader: activeLoader().familyKey,
        mode: PROFILE_MODE
      })
    });
    if (result && result.ok === false) throw new Error(result.error || 'Install failed');
    btn.textContent = t('common.done');
    toast(t('mods.installedToast', { name: version.fileName || t('mods.defaultName') }), 'ok');
    await loadMods();
  } catch (error) {
    btn.disabled = false;
    btn.textContent = was;
    toast(t('mods.downloadFailed', { message: error.message }), 'err');
  }
}

/* Панель описания теперь отдельный слой справа, а не вторая колонка списка.
   Раньше при окне 1100 px медиазапрос max-width:1120px схлопывал раскладку
   в одну колонку, и панель уезжала под весь список — замерено, её верх
   оказывался на 4103 px при высоте окна 607, то есть клик по моду менял
   описание, которого не видно. */
function closeModDetail() {
  const panel = $('#modDetail');
  if (!panel) return;
  panel.dataset.open = 'false';
  panel.classList.remove('detail-open');
  const scrim = $('#detailScrim');
  if (scrim) scrim.classList.remove('open');
  currentDetail = null;
  refreshFxObstacles();
}

/* Клик мимо панели закрывает её. Затемнение клики не ловит (см. .detail-scrim),
   иначе посмотреть описание соседнего мода можно было бы только через два
   нажатия: первое уходило в затемнение и закрывало панель, второе открывало
   новую. Поэтому клик по строке мода пропускаем — он сам сменит описание. */
document.addEventListener('click', (e) => {
  const panel = $('#modDetail');
  if (!panel || panel.dataset.open !== 'true') return;
  if (e.target.closest('#modDetail')) return;
  if (e.target.closest('.mod-row, .browser-mod-row')) return;
  closeModDetail();
});

/* ── Источник каталога ────────────────────────────────────────────────────────
   Modrinth и CurseForge отдают одинаковую форму, поэтому переключение —
   это одна переменная и повторный поиск. */
function setModSource(source) {
  cfg.modSource = source === 'curseforge' ? 'curseforge' : 'modrinth';
  syncModSourceSwitch();
  saveSettings();
  loadBrowserMods($('#modsSearch') ? $('#modsSearch').value : '');
}

function syncModSourceSwitch() {
  const host = $('#modSourceSwitch');
  if (!host) return;
  $$('#modSourceSwitch .mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.source === (cfg.modSource || 'modrinth'));
  });
}

/* Esc закрывает правые панели: из описания мода иначе можно было выйти только
   крестиком или кликом мимо. Проверяем, что панель вообще открыта — иначе Esc
   дёргал бы cancelMsaLogin на каждом нажатии. */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const detail = $('#modDetail');
  if (detail && detail.dataset.open === 'true') { closeModDetail(); return; }
  const accounts = $('#accountPanel');
  if (accounts && accounts.dataset.open === 'true') closeAccounts();
});

async function toggleSelectedMod() {
  if (!selectedMod) return;
  if (IS_FILE_PREVIEW) {
    const target = mods.find((mod) => mod.fileName === selectedMod.fileName);
    if (!target) return;
    target.enabled = !target.enabled;
    selectedMod = target;
    renderMods();
    selectMod(selectedMod);
    return;
  }
  try {
    await fetchJson('/api/mods', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: selectedMod.enabled ? 'disable' : 'enable',
        name: selectedMod.fileName,
        mcVersion: activeVersion(),
        mode: PROFILE_MODE
      })
    });
    await loadMods();
    const fresh = mods.find((mod) => mod.fileName === selectedMod.fileName);
    if (fresh) selectMod(fresh);
  } catch (error) {
    toast(`Mod toggle failed: ${error.message}`, 'err');
  }
}

async function restoreModsSnapshot() {
  if (IS_FILE_PREVIEW) {
    mods = PREVIEW_MODS.map((mod) => ({ ...mod }));
    renderMods();
    if (mods.length) selectMod(mods[0]);
    return;
  }
  try {
    await fetchJson('/api/mods', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'restore', name: '', mcVersion: activeVersion(), mode: PROFILE_MODE })
    });
    await loadMods();
  } catch (error) {
    toast(`Restore failed: ${error.message}`, 'err');
  }
}

async function runAutoDisable() {
  if (IS_FILE_PREVIEW) {
    mods = mods.map((mod) => (!mod.downloaded && mod.enabled && !mod.compatible ? { ...mod, enabled: false } : mod));
    renderMods();
    toast('Preview disabled incompatible mods', 'ok');
    return;
  }
  try {
    const result = await fetchJson(`/api/mods/auto-disable?mcVersion=${encodeURIComponent(activeVersion())}&mode=${encodeURIComponent(PROFILE_MODE)}`, { method: 'POST' });
    await loadMods();
    toast(`Auto-disabled: ${(result.disabled || []).length}`, 'ok');
  } catch (error) {
    toast(`Auto-disable failed: ${error.message}`, 'err');
  }
}

/**
 * Ставит набор модов производительности одним нажатием.
 *
 * Самый заметный рычаг для слабой машины: флаги JVM убирают рывки, а эти моды
 * поднимают сам FPS — один Sodium переписывает рендерер целиком.
 */
async function installPerformancePack() {
  const loader = activeLoader();
  if (loader.familyKey === 'vanilla') {
    toast(t('mods.perfFabricOnly'), 'err');
    return;
  }
  const version = activeVersion();
  if (IS_FILE_PREVIEW) {
    toast(`Preview: набор производительности для ${version}`, 'ok');
    return;
  }
  toast(t('mods.perfInstalling'), 'ok');
  try {
    const result = await fetchJson('/api/mods/install-performance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mcVersion: version, loader: loader.familyKey, mode: PROFILE_MODE })
    });
    const failed = result.failed || 0;
    if (failed) {
      const names = (result.results || []).filter((r) => !r.ok).map((r) => r.name).join(', ');
      toast(t('mods.perfPartial', { installed: result.installed, failed, names }), 'err');
    } else {
      toast(t('mods.perfDone', { count: result.installed }), 'ok');
    }
    await loadMods();
    refreshFxObstacles();
  } catch (e) {
    toast(t('common.failed', { message: e.message }), 'err');
  }
}

async function autoInstallRequiredMods() {
  const loader = activeLoader();
  if (loader.familyKey === 'vanilla') {
    toast(t('mods.autoInstallPickLoader'), 'err');
    return;
  }
  const version = activeVersion();
  if (IS_FILE_PREVIEW) {
    toast(`Preview: auto-install для ${loader.family} ${version}`, 'ok');
    return;
  }
  toast(t('mods.autoInstalling'), 'ok');
  try {
    const result = await fetchJson('/api/mods/auto-install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mcVersion: version, loader: loader.familyKey, mode: PROFILE_MODE })
    });
    const count = result.installed?.length || 0;
    toast(count > 0 ? t('mods.autoInstalledCount', { count }) : t('mods.autoAllInstalled'), 'ok');
    await loadMods();
  } catch (e) {
    toast(`Auto-install failed: ${e.message}`, 'err');
  }
}

async function checkModUpdates() {
  if (IS_FILE_PREVIEW) {
    toast('Preview: 1 important mod update found', 'ok');
    return;
  }
  try {
    const result = await fetchJson(`/api/mods/check-updates?mcVersion=${encodeURIComponent(activeVersion())}&mode=${encodeURIComponent(PROFILE_MODE)}`);
    const important = (result.results || []).filter((item) => item.criticalUpdate).length;
    toast(`Important updates: ${important}`, 'ok');
  } catch (error) {
    toast(`Update check failed: ${error.message}`, 'err');
  }
}

function debouncedBrowserSearch(query) {
  clearTimeout(browserSearchTimer);
  browserSearchTimer = setTimeout(() => runBrowserSearch(query), 240);
}

async function runBrowserSearch(query) {
  await loadBrowserMods(query);
}

function filterMods(query) {
  const needle = query.trim().toLowerCase();
  $$('.mod-row').forEach((row) => {
    row.style.display = !needle || row.textContent.toLowerCase().includes(needle) ? '' : 'none';
  });
}

function highlightCompatibleMods() {
  $$('.mod-row').forEach((row) => {
    const mod = mods.find((item) => item.fileName === row.dataset.name);
    if (!mod) return;
    row.style.opacity = mod.compatible === false ? '.72' : '1';
  });
}

function updateRam(value) {
  const mb = Number(value);
  cfg.ramMb = mb;
  $('#ramValue').textContent = mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`;
}

async function saveSettings(showToast = false) {
  cfg.javaPath = $('#javaPath').value.trim();
  cfg.autoJava = $('#autoJava').checked;
  cfg.ramMb = Number($('#ramSlider').value);
  cfg.autoUpdateMods = $('#autoUpdateMods').checked;
  cfg.autoDisableIncompatibleMods = $('#autoDisableMods').checked;
  cfg.useDownloadedModsLibrary = $('#useDownloadedModsLibrary').checked;
  cfg.musicEnabled = $('#musicEnabled').checked;
  cfg.musicVolume = Number($('#musicVolumeSlider').value);
  cfg.lastTheme = currentTheme;
  const keyInput = $('#curseforgeKey');
  if (keyInput) cfg.curseforgeKey = keyInput.value.trim();
  const langSelect = $('#langSelect');
  if (langSelect && langSelect.value) cfg.language = langSelect.value;

  if (IS_FILE_PREVIEW) {
    if (showToast) toast('Preview settings saved locally', 'ok');
    return;
  }

  try {
    await fetchJson('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ramMb: cfg.ramMb,
        autoUpdateMods: cfg.autoUpdateMods,
        autoDisableIncompatibleMods: cfg.autoDisableIncompatibleMods,
        useDownloadedModsLibrary: cfg.useDownloadedModsLibrary,
        musicEnabled: cfg.musicEnabled,
        musicVolume: cfg.musicVolume,
        lastTheme: cfg.lastTheme,
        javaPath: cfg.javaPath,
        autoJava: cfg.autoJava,
        selectedVersion: cfg.selectedVersion,
        vanillaVersion: cfg.vanillaVersion,
        vanillaLoaderId: cfg.vanillaLoaderId,
        curseforgeKey: cfg.curseforgeKey,
        modSource: cfg.modSource,
        language: cfg.language
      })
    });
    if (showToast) toast('Settings saved', 'ok');
  } catch (error) {
    toast(`Save failed: ${error.message}`, 'err');
  }
}

/* ── Язык интерфейса ──────────────────────────────────────────────────────────
   Сам словарь живёт в js/i18n.js. Здесь только применение: заполнить список
   языков, сохранить выбор и перерисовать то, что строится из JS — статичную
   разметку i18n переводит сам. */
function applyLanguage(code, persist) {
  const wanted = code === 'en' ? 'en' : 'ru';
  cfg.language = wanted;
  I18N.setLang(wanted);
  if (persist !== false) saveSettings();

  const select = $('#langSelect');
  if (select) {
    if (!select.options.length) {
      for (const l of I18N.langs) select.appendChild(new Option(l.label, l.code));
    }
    select.value = wanted;
  }
  // Перерисовываем то, что собрано в JS: подписи режима, список версий,
  // установленные моды и панель аккаунтов
  try {
    setTheme(currentTheme, false);
    renderVersionList();
    renderMods();
    renderAccounts();
  } catch (error) {
    console.warn('[i18n] часть интерфейса не перерисовалась:', error.message);
  }
}

/* Из i18n.js: там язык меняется из туториала, и интерфейс должен последовать */
window.saveLanguage = (code) => applyLanguage(code, true);

/* Кнопка «Пройти обучение заново» в настройках */
function startTutorial() {
  if (window.Tutorial) window.Tutorial.start(true);
}

/* ── Spotify modal dialog ──────────────────────────────────────────────────────

/** Open the Spotify setup/info modal */
function openSpotifyModal() {
  const modal = $('#spotifyModal');
  if (modal) {
    modal.classList.add('open');
    // Pre-fill input from previous session if available
    const saved = localStorage.getItem('spotifyUrl');
    if (saved) $('#spotifyModalInput').value = saved;
    setTimeout(() => $('#spotifyModalInput')?.focus(), 80);
  }
}

/** Close the Spotify modal */
function closeSpotifyModal() {
  const modal = $('#spotifyModal');
  if (modal) modal.classList.remove('open');
}

/** Close modal on backdrop click */
function onSpotifyModalBackdrop(event) {
  if (event.target === $('#spotifyModal')) closeSpotifyModal();
}

/** Open Spotify from the modal */
function openSpotifyFromModal() {
  const input = $('#spotifyModalInput');
  if (!input) return;
  const raw = input.value.trim();
  if (!raw) { toast(t('sp.needLink'), 'err'); return; }

  const match = raw.match(/playlist[/:]([A-Za-z0-9]+)/);
  let targetUrl = null;
  if (match) {
    targetUrl = `https://open.spotify.com/playlist/${match[1]}`;
  } else if (raw.startsWith('https://open.spotify.com') || raw.startsWith('http://open.spotify.com')) {
    targetUrl = raw;
  }

  if (!targetUrl) {
    toast(t('sp.example'), 'err');
    return;
  }

  localStorage.setItem('spotifyUrl', raw);
  closeSpotifyModal();

  // Open full Spotify Web Player in a separate Electron window with persistent session
  if (window.pulse && window.pulse.openSpotifyPlayer) {
    window.pulse.openSpotifyPlayer(targetUrl);
  } else {
    window.open(targetUrl, '_blank');
  }
  toast(t('sp.openedToast'), 'ok');
}

/** Legacy trigger from the music card button */
function openSpotify() {
  openSpotifyModal();
}

async function loadMusicState() {
  if (IS_FILE_PREVIEW) {
    musicState = {
      ...musicState,
      playing: cfg.musicEnabled !== false,
      volume: cfg.musicVolume ?? 70,
      currentTrack: 'Preview playlist',
      currentTrackType: 'audio',
      musicDir: cfg.paths.music,
      crossfadeSeconds: 4,
      playlist: PREVIEW_TRACKS.map((track) => track.title)
    };
    applyMusicState(musicState);
    if (cfg.musicEnabled !== false) startPreviewPlaylist();
    return;
  }
  try {
    const state = await fetchJson('/api/music/state');
    const tracks = await fetchJson('/api/music/tracks').catch(() => ({ tracks: [] }));
    applyMusicState({ ...state, playlist: tracks.tracks || state.playlist || [] });
    previewTrackList = await hydrateRuntimeTracks(tracks.tracks || []);
    if (cfg.musicEnabled !== false && !activeAudio?.src && !activeBytebeat) startPreviewPlaylist();
  } catch {
    applyMusicState({
      playing: cfg.musicEnabled !== false,
      volume: cfg.musicVolume ?? 70,
      currentTrack: 'Music backend unavailable',
      currentTrackType: 'idle',
      musicDir: cfg.paths.music,
      crossfadeSeconds: 4,
      playlist: PREVIEW_TRACKS.map((track) => track.title)
    });
  }
}

async function hydrateRuntimeTracks(fileNames) {
  if (!fileNames.length) return PREVIEW_TRACKS.slice();
  return fileNames.map((name) => {
    const lower = name.toLowerCase();
    if (lower.endsWith('.mp3') || lower.endsWith('.wav') || lower.endsWith('.ogg')) {
      return { type: 'mp3', title: name.replace(/\.[^.]+$/, ''), src: `${API}/api/music/file?name=${encodeURIComponent(name)}` };
    }
    return { type: 'bytebeat', title: name.replace(/\.[^.]+$/, ''), source: `${API}/api/music/file?name=${encodeURIComponent(name)}` };
  });
}

function applyMusicState(data) {
  musicState = { ...musicState, ...data };
  $('#musicTrackTitle').textContent = data.currentTrack || 'No track loaded';
  $('#musicStatus').textContent = `Crossfade ${data.crossfadeSeconds || 4}s - ${data.musicDir || cfg.paths.music}`;
  $('#musicPlayBtn').textContent = data.playing ? 'Pause' : 'Play';
  onMusicVolume(data.volume ?? cfg.musicVolume ?? 70, false);
}

async function toggleMusicPlayback() {
  if (IS_FILE_PREVIEW) {
    musicState.playing = !musicState.playing;
    $('#musicPlayBtn').textContent = musicState.playing ? 'Pause' : 'Play';
    if (musicState.playing) resumeAudio();
    else pauseAudio();
    return;
  }
  try {
    applyMusicState(await fetchJson('/api/music/toggle', { method: 'POST' }));
    if (musicState.playing) resumeAudio();
    else pauseAudio();
  } catch (error) {
    toast(`Music toggle failed: ${error.message}`, 'err');
  }
}

async function nextTrack() {
  await playNextPreviewTrack();
  if (!IS_FILE_PREVIEW) {
    fetchJson('/api/music/next', { method: 'POST' }).then(applyMusicState).catch(() => {});
  }
}

async function onMusicVolume(value, persist = true) {
  $('#musicVolumeSlider').value = value;
  $('#musicVolumeSettings').value = value;
  $('#musicVolumeValue').textContent = `${value}%`;
  cfg.musicVolume = Number(value);
  musicState.volume = Number(value);
  syncAudioVolumes();

  if (!persist) return;
  if (IS_FILE_PREVIEW) return;
  try {
    applyMusicState(await fetchJson('/api/music/volume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ volume: Number(value) / 100 })
    }));
  } catch (error) {
    toast(`Music volume failed: ${error.message}`, 'err');
  }
}

function startPreviewPlaylist() {
  if (!musicState.playing) return;
  playNextPreviewTrack().catch(() => {});
}

async function playNextPreviewTrack() {
  const list = previewTrackList?.length ? previewTrackList : PREVIEW_TRACKS;
  if (!musicState.playing || !list.length) return;
  stopBytebeat();
  currentTrackIndex = (currentTrackIndex + 1) % list.length;
  const track = list[currentTrackIndex];
  $('#musicTrackTitle').textContent = track.title;

  if (track.type === 'bytebeat') {
    $('#musicStatus').textContent = `Bytebeat ${track.title}`;
    await playBytebeatTrack(track);
    return;
  }

  $('#musicStatus').textContent = `Playlist track - ${track.title}`;
  const nextAudio = activeAudio === audioA ? audioB : audioA;
  nextAudio.src = track.src;
  nextAudio.volume = 0;
  await nextAudio.play().catch(() => {});
  crossfadeAudio(activeAudio, nextAudio, 1800);
  activeAudio = nextAudio;
  musicState.currentTrack = track.title;
  musicState.currentTrackType = 'audio';
}

function crossfadeAudio(fromAudio, toAudio, durationMs) {
  const start = performance.now();
  const targetVolume = (musicState.volume || 70) / 100;
  const fade = (now) => {
    const progress = Math.min(1, (now - start) / durationMs);
    if (fromAudio) fromAudio.volume = targetVolume * (1 - progress);
    if (toAudio) toAudio.volume = targetVolume * progress;
    if (bytebeatGain) bytebeatGain.gain.value = targetVolume * (1 - progress);
    if (progress < 1) requestAnimationFrame(fade);
    else if (fromAudio) {
      fromAudio.pause();
      fromAudio.currentTime = 0;
    }
  };
  requestAnimationFrame(fade);
}

// Bytebeat sources come in three shapes, and only the first one used to work:
//   - an inline formula           → used as-is
//   - a .txt file shipped with us → must be fetched
//   - a dollchan share link       → fetched, then decoded from its #4 hash
// A bare file path was compiled as a string literal, so those tracks played silence.
async function loadBytebeatSource(source) {
  const isPath = /^https?:/i.test(source) || /\.txt(\?|$)/i.test(source) || source.startsWith('/');
  if (!isPath) return source;
  const resp = await fetch(source);
  if (!resp.ok) throw new Error(`Track not found: ${source}`);
  return (await resp.text()).trim();
}

const BYTEBEAT_MODES = ['bytebeat', 'signed', 'floatbeat', 'funcbeat'];

// The hash spells modes as 'Bytebeat' / 'Signed Bytebeat' while the compiler
// switches on lowercase names, so 'Bytebeat' silently fell through to the default.
function normalizeBytebeatMode(mode) {
  const key = String(mode || '').toLowerCase().replace(/\s+/g, '');
  if (key === 'signedbytebeat' || key === 'signed') return 'signed';
  if (key === 'floatbeat') return 'floatbeat';
  if (key === 'funcbeat') return 'funcbeat';
  return 'bytebeat';
}

async function playBytebeatTrack(track) {
  pauseAudio();
  stopBytebeat();
  stopBytebeatFFT();

  let mode = track.mode || bytebeatConfig.mode || 'floatbeat';
  let sampleRate = track.sampleRate || bytebeatConfig.sampleRate || 44100;

  let code = await loadBytebeatSource(track.source);

  // A dollchan link carries the formula compressed in its hash — and the hash also
  // owns the mode and the sample rate. Taking only the code (as before) left an
  // 8-bit formula running as floatbeat, where everything clamps to a constant and
  // clicks instead of playing. The hash wins over whatever the caller guessed.
  const hashIndex = code.indexOf('#');
  if (hashIndex >= 0) {
    const parsed = await parseBytebeatHash(code.substring(hashIndex));
    if (parsed) {
      code = parsed.code;
      if (parsed.mode) mode = parsed.mode;
      if (parsed.sampleRate) sampleRate = parsed.sampleRate;
    }
  }
  mode = normalizeBytebeatMode(mode);

  const compiledFunc = compileBytebeat(code, mode);
  if (!compiledFunc) {
    throw new Error('Failed to compile bytebeat formula');
  }

  // One context for every track: the rate a track was authored at is applied by
  // stepping its clock instead of rebuilding the context underneath it.
  if (!bytebeatCtx) {
    bytebeatCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
  }

  const ctx = bytebeatCtx;
  if (ctx.state !== 'running') {
    await ctx.resume().catch(() => {});
  }

  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(ctx.destination);
  bytebeatGain = gain;

  const processor = ctx.createScriptProcessor(2048, 1, 2);
  // A track authored at 8 kHz must advance its clock by 8000/48000 per output sample,
  // otherwise it plays at the wrong pitch and speed. The clock itself stays an INTEGER:
  // formulas index arrays with it (X[(t+1) % X.length]), a fractional index reads
  // undefined, turns into NaN and poisons their state for good. Only the whole part
  // advances t; the fraction is carried separately.
  const step = sampleRate / ctx.sampleRate;
  let sample = 0;
  let carry = 0;
  const targetVolume = (musicState.volume || 70) / 100;

  // One-pole DC blocker per channel: y[n] = x[n] - x[n-1] + R*y[n-1].
  // Bytebeat output routinely sits on a large DC offset — Saturn holds about -0.95 for
  // its first 45 seconds — which a speaker can only answer with a thump, and subsonic
  // drift is what made the old tracks sound like flatulence. This removes both without
  // touching the timbre.
  const DC_R = 0.995;
  const dcPrevIn = [0, 0];
  const dcPrevOut = [0, 0];
  const dcBlock = (x, ch) => {
    const y = x - dcPrevIn[ch] + DC_R * dcPrevOut[ch];
    dcPrevIn[ch] = x;
    dcPrevOut[ch] = y;
    return y;
  };

  processor.onaudioprocess = (event) => {
    const left = event.outputBuffer.getChannelData(0);
    const right = event.outputBuffer.getChannelData(1);
    const channels = [left, right];
    for (let i = 0; i < left.length; i++) {
      try {
        const rawOut = compiledFunc(sample);
        carry += step;
        while (carry >= 1) { carry -= 1; sample++; }
        const normalized = normalizeBytebeatOutput(rawOut, mode);
        for (let ch = 0; ch < 2; ch++) {
          let value = dcBlock(normalized[ch], ch);
          if (value > 1) value = 1;
          else if (value < -1) value = -1;
          channels[ch][i] = value;
        }
      } catch (e) {
        left[i] = 0;
        right[i] = 0;
      }
    }
  };

  let driver;
  if (ctx.createConstantSource) {
    driver = ctx.createConstantSource();
    driver.offset.value = 0;
    driver.start();
  } else {
    driver = ctx.createOscillator();
    driver.frequency.value = 0;
    driver.start();
  }
  const driverGain = ctx.createGain();
  driverGain.gain.value = 0;
  driver.connect(driverGain);
  driverGain.connect(processor);
  processor.connect(gain);

  activeBytebeatSource = driver;
  activeBytebeat = processor;

  const started = performance.now();
  const fadeIn = (now) => {
    const progress = Math.min(1, (now - started) / 1600);
    if (bytebeatGain) bytebeatGain.gain.value = targetVolume * progress;
    if (progress < 1) requestAnimationFrame(fadeIn);
  };
  requestAnimationFrame(fadeIn);

  clearTimeout(bytebeatTimer);
  bytebeatTimer = setTimeout(() => {
    if (musicState.playing) nextTrack();
  }, 75000);

  musicState.currentTrack = track.title;
  musicState.currentTrackType = 'bytebeat';
}

async function decodeBytebeatTrack(track) {
  try {
    const sourceText = await fetch(track.source).then((r) => r.text());
    const content = sourceText.trim();

    // Если это прямая формула (не URL) — используем напрямую
    if (!content.startsWith('http') && !content.startsWith('#')) {
      return { mode: 'Bytebeat', sampleRate: 8000, code: content };
    }

    // Если это URL с hash — парсим hash
    const hashIndex = content.indexOf('#');
    if (hashIndex < 0) return null;
    return await parseBytebeatHash(content.substring(hashIndex));
  } catch {
    return null;
  }
}

async function parseBytebeatHash(hash) {
  if (!hash.startsWith('#4')) return null;
  const base64 = normalizeBase64(hash.substring(2));
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const mode = ['Bytebeat', 'Signed Bytebeat', 'Floatbeat', 'Funcbeat'][bytes[0]] || 'Bytebeat';
  const sampleRate = new DataView(bytes.buffer).getFloat32(1, true);
  const code = await inflateRawString(bytes.slice(5));
  return { mode, sampleRate, code };
}

function normalizeBase64(input) {
  let value = input.replace(/-/g, '+').replace(/_/g, '/');
  while (value.length % 4 !== 0) value += '=';
  return value;
}

async function inflateRawString(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof DecompressionStream === 'function') {
    const ds = new DecompressionStream('deflate-raw');
    const blob = new Blob([input]);
    const buffer = await new Response(blob.stream().pipeThrough(ds)).arrayBuffer();
    return new TextDecoder().decode(buffer);
  }
  throw new Error('DecompressionStream is unavailable');
}

// dollchan.net formulas are written against bare sin/cos/abs/PI — in the dollchan player
// those are globals, but the browser only has Math.*. Without this prelude the compiled
// function throws ReferenceError on the very first sample and the processor writes
// silence. `var` rather than `const`: dollchan's are writable globals and formulas do
// reassign them (Saturn reads `sin` into its own R, Dream Space does `f = Array`).
const BYTEBEAT_PRELUDE =
  'var PI=Math.PI,E=Math.E,sin=Math.sin,cos=Math.cos,tan=Math.tan,' +
  'asin=Math.asin,acos=Math.acos,atan=Math.atan,sinh=Math.sinh,cosh=Math.cosh,' +
  'tanh=Math.tanh,abs=Math.abs,floor=Math.floor,ceil=Math.ceil,round=Math.round,' +
  'min=Math.min,max=Math.max,pow=Math.pow,sqrt=Math.sqrt,log=Math.log,exp=Math.exp,' +
  'sign=Math.sign,random=Math.random,int=Math.floor;';

function compileBytebeat(code, mode = 'floatbeat') {
  try {
    mode = normalizeBytebeatMode(mode);

    switch (mode) {
      case 'bytebeat':
        // 8-bit unsigned (0-255)
        return new Function('t', `${BYTEBEAT_PRELUDE}return ((${code}) & 255);`);

      case 'signed':
        // 8-bit signed (-128 to 127)
        return new Function('t', `${BYTEBEAT_PRELUDE}const v = ((${code}) & 255); return v > 127 ? v - 256 : v;`);

      case 'funcbeat':
        // Function returns array or generator
        return new Function('t', `${BYTEBEAT_PRELUDE}return (${code})(t);`);

      case 'floatbeat':
      default:
        // Return raw float value (any range)
        return new Function('t', `${BYTEBEAT_PRELUDE}return (${code});`);
    }
  } catch (e) {
    console.error('[Bytebeat] Compile error:', e);
    return null;
  }
}

function normalizeBytebeatOutput(value, mode) {
  mode = normalizeBytebeatMode(mode);
  const pair = Array.isArray(value) ? [value[0], value[1]] : [value, value];
  return pair.map((sample) => {
    const num = Number(sample) || 0;
    switch (mode) {
      case 'signed':
        return (((num + 128) & 255) / 127.5) - 1;
      case 'floatbeat':
      case 'funcbeat':
        return Math.max(-1, Math.min(1, num));
      case 'bytebeat':
      default:
        return ((num & 255) / 127.5) - 1;
    }
  });
}

function ensureAudioContext() {
  if (!window.__pulseAudioContext) {
    window.__pulseAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
  }
  const ctx = window.__pulseAudioContext;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function resumeAudioContextOnce() {
  const ctx = window.__pulseAudioContext;
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

function stopBytebeat() {
  clearTimeout(bytebeatTimer);
  bytebeatTimer = null;
  stopBytebeatFFT();
  if (activeBytebeatSource) {
    try { activeBytebeatSource.stop(); } catch (_) {}
    activeBytebeatSource.disconnect();
    activeBytebeatSource = null;
  }
  if (activeBytebeat) {
    activeBytebeat.disconnect();
    activeBytebeat.onaudioprocess = null;
    activeBytebeat = null;
  }
  if (bytebeatGain) {
    bytebeatGain.disconnect();
    bytebeatGain = null;
  }
  if (bytebeatAnalyser) {
    bytebeatAnalyser.disconnect();
    bytebeatAnalyser = null;
  }
}

function pauseAudio() {
  [audioA, audioB].forEach((audio) => audio?.pause());
  if (bytebeatGain) bytebeatGain.gain.value = 0;
}

function resumeAudio() {
  if (musicState.currentTrackType === 'bytebeat' && activeBytebeat) {
    syncAudioVolumes();
    return;
  }
  if (!activeAudio?.src) {
    startPreviewPlaylist();
    return;
  }
  activeAudio.play().catch(() => {});
}

function syncAudioVolumes() {
  const targetVolume = (musicState.volume || 70) / 100;
  if (activeAudio) activeAudio.volume = targetVolume;
  if (bytebeatGain) bytebeatGain.gain.value = targetVolume;
}

function toast(message, kind = 'ok') {
  const stack = $('#toastStack');
  const item = document.createElement('div');
  item.className = `toast ${kind}`;
  item.textContent = message;
  stack.appendChild(item);
  setTimeout(() => item.remove(), 3000);
}

function fetchJson(path, options) {
  return fetch(`${API}${path}`, options).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || response.statusText || 'Request failed');
    }
    return data;
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cssEscape(value) {
  return String(value).replace(/"/g, '\\"');
}

function formatDownloads(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ===== BYTEBEAT UI =====

let bytebeatConfig = {
  mode: 'floatbeat',
  sampleRate: 44100,
  fftSize: 1024,
  visualizerHeight: 120
};

let bytebeatAnalyser = null;
let bytebeatFFTAnimationId = null;

// Bytebeat playlist. The mode and sample rate belong to the TRACK, not to the settings
// modal: both formulas are written against a 44100 clock and are floatbeat programs,
// so a rate picked in Settings would play them at the wrong pitch and speed. The .txt
// files hold the raw formula; a dollchan share link still decodes through its hash.
const BYTEBEAT_TRACKS = [
  { id: 'saturn',      title: 'Saturn',      icon: '🪐', file: 'bytebeat/saturn.txt',      mode: 'floatbeat', sampleRate: 44100 },
  { id: 'dream_space', title: 'Dream Space', icon: '🌌', file: 'bytebeat/dream_space.txt', mode: 'floatbeat', sampleRate: 44100 }
];
let bytebeatIndex = 0;

function updateBytebeatNowPlaying() {
  const track = BYTEBEAT_TRACKS[bytebeatIndex];
  if (!track) return;
  const playing = Boolean(activeBytebeat) && musicState.playing !== false;
  const icon = $('#bytebeatNowIcon');
  const title = $('#bytebeatNowTitle');
  const meta = $('#bytebeatNowMeta');
  const btn = $('#bytebeatPlayBtn');
  const position = t('bb.trackOf', { n: bytebeatIndex + 1, total: BYTEBEAT_TRACKS.length });
  if (icon) icon.textContent = track.icon;
  if (title) title.textContent = track.title;
  if (meta) meta.textContent = t('bb.nowPlaying', { state: playing ? t('bb.playing') : t('music.pause'), position });
  if (btn) btn.textContent = playing ? '⏸' : '▶';
}

async function playBytebeatAt(index) {
  const total = BYTEBEAT_TRACKS.length;
  bytebeatIndex = ((index % total) + total) % total;
  const track = BYTEBEAT_TRACKS[bytebeatIndex];
  updateBytebeatNowPlaying();
  try {
    await playBytebeatTrack({
      type: 'bytebeat',
      title: track.title,
      source: track.file,
      mode: track.mode,
      sampleRate: track.sampleRate
    });
    musicState.playing = true;
    musicState.currentTrack = track.title;
    musicState.currentTrackType = 'bytebeat';
    $('#musicTrackTitle').textContent = track.title;
    $('#musicStatus').textContent = t('music.bytebeatTrack', { title: track.title });
    $('#musicPlayBtn').textContent = 'Pause';
    startBytebeatFFT();
  } catch (e) {
    toast(t('music.trackFailed', { message: e.message }), 'err');
  }
  updateBytebeatNowPlaying();
}

function nextBytebeatTrack() { playBytebeatAt(bytebeatIndex + 1); }
function prevBytebeatTrack() { playBytebeatAt(bytebeatIndex - 1); }

function toggleBytebeatPlayback() {
  if (activeBytebeat) {
    stopBytebeat();
    musicState.playing = false;
    updateBytebeatNowPlaying();
    return;
  }
  musicState.playing = true;
  playBytebeatAt(bytebeatIndex);
}

function switchMusicTab(tab) {
  currentMusicTab = tab;
  ['mp3', 'bytebeat', 'playlist'].forEach(t => {
    const btn = $(`#musicTab${t.charAt(0).toUpperCase() + t.slice(1)}`);
    const panel = $(`#musicPanel${t.charAt(0).toUpperCase() + t.slice(1)}`);
    if (btn) btn.classList.toggle('active', t === tab);
    if (panel) panel.classList.toggle('active', t === tab);
  });
  if (tab === 'bytebeat') { startBytebeatFFT(); updateBytebeatNowPlaying(); }
  if (tab === 'mp3') renderMP3List();
}

async function playBytebeatById(trackId) {
  const index = BYTEBEAT_TRACKS.findIndex(t => t.id === trackId);
  if (index < 0) return;
  await playBytebeatAt(index);
}

function startBytebeatFFT() {
  if (!bytebeatCtx || !activeBytebeat) return;

  if (!bytebeatAnalyser) {
    bytebeatAnalyser = bytebeatCtx.createAnalyser();
    bytebeatAnalyser.fftSize = bytebeatConfig.fftSize;
    activeBytebeat.connect(bytebeatAnalyser);
  } else {
    bytebeatAnalyser.fftSize = bytebeatConfig.fftSize;
  }

  if (bytebeatFFTAnimationId) cancelAnimationFrame(bytebeatFFTAnimationId);

  const canvas = $('#bytebeatFFTCanvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const bufferLength = bytebeatAnalyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function draw() {
    bytebeatFFTAnimationId = requestAnimationFrame(draw);
    bytebeatAnalyser.getByteFrequencyData(dataArray);

    const width = canvas.width;
    const height = canvas.height;

    ctx.fillStyle = 'rgba(11,14,20,0.3)';
    ctx.fillRect(0, 0, width, height);

    const barWidth = (width / bufferLength) * 2.5;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * height;

      const hue = 270 + (i / bufferLength) * 30; // violet to cyan
      ctx.fillStyle = `hsla(${hue}, 70%, 60%, 0.8)`;
      ctx.fillRect(x, height - barHeight, barWidth, barHeight);

      x += barWidth + 1;
    }
  }

  draw();
}

function stopBytebeatFFT() {
  if (bytebeatFFTAnimationId) {
    cancelAnimationFrame(bytebeatFFTAnimationId);
    bytebeatFFTAnimationId = null;
  }
}

function openBytebeatSettings() {
  $('#bytebeatSettingsModal').style.display = 'flex';
  // Set current values
  $('#bytebeatModeSelect').value = bytebeatConfig.mode;
  $('#bytebeatSampleRateSelect').value = bytebeatConfig.sampleRate.toString();
  $('#bytebeatFFTSizeSelect').value = bytebeatConfig.fftSize.toString();
  $('#bytebeatVisualizerHeight').value = bytebeatConfig.visualizerHeight.toString();
  $('#visualizerHeightLabel').textContent = bytebeatConfig.visualizerHeight + 'px';
}

function closeBytebeatSettings() {
  $('#bytebeatSettingsModal').style.display = 'none';
}

function updateBytebeatMode() {
  bytebeatConfig.mode = $('#bytebeatModeSelect').value;
  toast(`Mode: ${bytebeatConfig.mode}`, 'ok');
}

function updateBytebeatSampleRate() {
  bytebeatConfig.sampleRate = parseInt($('#bytebeatSampleRateSelect').value);
  toast(`Sample rate: ${bytebeatConfig.sampleRate}Hz`, 'ok');
}

function updateBytebeatFFTSize() {
  bytebeatConfig.fftSize = parseInt($('#bytebeatFFTSizeSelect').value);
  if (bytebeatAnalyser) {
    bytebeatAnalyser.fftSize = bytebeatConfig.fftSize;
  }
  toast(t('bb.fftToast', { size: bytebeatConfig.fftSize }), 'ok');
}

function updateVisualizerHeight(value) {
  bytebeatConfig.visualizerHeight = parseInt(value);
  $('#visualizerHeightLabel').textContent = value + 'px';
  const canvas = $('#bytebeatFFTCanvas');
  if (canvas) {
    canvas.height = bytebeatConfig.visualizerHeight;
  }
}

function renderMP3List() {
  const list = $('#mp3FilesList');
  if (!list) return;
  fetchJson('/api/music/tracks').then(resp => {
    if (!resp.ok || !resp.tracks) {
      list.innerHTML = `<div style="color:rgba(255,255,255,0.3);font-size:12px;padding:8px;">${escapeHtml(t('music.noAudio'))}</div>`;
      return;
    }
    const mp3s = resp.tracks.filter(name => /\.(mp3|wav|ogg)$/i.test(name));
    if (!mp3s.length) {
      list.innerHTML = `<div style="color:rgba(255,255,255,0.3);font-size:12px;padding:8px;">${escapeHtml(t('music.noAudio'))}</div>`;
      return;
    }
    list.innerHTML = mp3s.map(name => `
      <div class="bytebeat-library-item">
        <span>${escapeHtml(name)}</span>
        <button onclick="playMP3File('${escapeHtml(name)}')">${t('music.play')}</button>
      </div>
    `).join('');
  });
}

async function playMP3File(filename) {
  const track = {
    type: 'mp3',
    title: filename.replace(/\.[^.]+$/, ''),
    src: `${API}/api/music/file?name=${encodeURIComponent(filename)}`
  };
  pauseAudio();
  stopBytebeat();
  stopBytebeatFFT();
  activeAudio = audioA;
  audioA.src = track.src;
  audioA.play().catch(() => {});
  $('#musicTrackTitle').textContent = track.title;
  $('#musicStatus').textContent = t('music.audioTrack', { name: filename });
  musicState.currentTrack = track.title;
  musicState.currentTrackType = 'audio';
}

function openMusicFolder() {
  // Именно папка музыки: раньше кнопка открывала игровую — рядом с треками
  // игрок оказывался в mods/, и это выглядело поломкой.
  window.pulse?.openFolder(cfg?.paths?.music);
}
