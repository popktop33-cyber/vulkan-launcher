/*
 * Витрина скинов ely.by внутри лаунчера.
 *
 * Зачем своя витрина, если у сайта она есть: на сайте, чтобы надеть скин,
 * нужно уйти из лаунчера, найти скин, нажать «надеть», вернуться и ещё
 * вспомнить про кнопку обновления. Здесь это одно нажатие.
 *
 * Три вещи устроены неочевидно, и все три — вынужденно.
 *
 * 1. КАРТИНКИ ИДУТ ЧЕРЕЗ СВОЙ БЭКЕНД, а не прямо с ely.by. Две причины.
 *    Первая: чужая картинка, положенная в canvas, делает его «грязным», и
 *    диорама не смогла бы её использовать. Вторая: так работает дисковый кэш —
 *    пролистав каталог дважды, мы не тянем те же картинки повторно.
 *    Наружу при этом уходит ХЕШ файла, а не адрес: бэкенд сам собирает URL,
 *    поэтому подсунуть ему чужую ссылку нельзя.
 *
 * 2. ФИЛЬТР 18+ РАБОТАЕТ НА БЭКЕНДЕ. Поля «взрослое» у ely.by нет вовсе —
 *    ни в одном ответе каталога, ни с флагом showSensitiveContent, ни без
 *    него (тот флаг оказался личным списком скрытого у игрока: меняет 3 скина
 *    из 40). Поэтому решает наш собственный список тегов, и решает на сервере:
 *    включённый тумблер не «проявляет» уже приехавшее, а просто не присылает.
 *
 * 3. ПОСЛЕ НАДЕВАНИЯ НАДО СБРОСИТЬ КЭШ СКИНА. SkinService держит удачный ответ
 *    сутки. Без сброса лаунчер показывал бы старый скин ещё день, и это
 *    выглядело бы как «кнопка не работает». Поэтому после удачи идёт
 *    POST /api/skin/{ник}/refresh — тот же путь, что и у кнопки «Обновить скин».
 */
(function () {
  'use strict';

  const S = {
    open: false,
    loading: false,
    page: 0,
    last: 1,
    total: 0,
    q: '',
    safe: true,        // скрывать 18+
    slim: '',          // '' | 'slim' | 'classic'
    nick: '',
    loggedIn: false,
    all: [],           // всё, что уже приехало с сервера
    hidden: 0,
    wornId: 0          // какой скин надели в этой сессии — чтобы пометить его
  };

  let searchTimer = null;

  const $ = (sel) => document.querySelector(sel);

  /** Тост, если он есть. В браузере без оболочки его нет — молчим, не падаем. */
  function say(msg, kind) {
    if (typeof toast === 'function') toast(msg, kind);
  }

  function tr(key, fallback) {
    const v = typeof t === 'function' ? t(key) : null;
    return v && v !== key ? v : fallback;
  }

  function previewUrl(hash) {
    return API + '/api/elyby/preview/' + encodeURIComponent(hash) + '.png';
  }

  /** Число с разделителями: 28249 читается хуже, чем 28 249. */
  function num(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  // ── Состояние входа ───────────────────────────────────────────────────────

  /**
   * Кто вошёл на ely.by.
   *
   * Источник один — app.js: тот же ник показывает панель аккаунтов, и знать его
   * в двух местах по-разному нельзя. Здесь только перекладываем в своё
   * состояние, чтобы дальше не оглядываться.
   */
  async function loadState() {
    if (typeof elybyRefresh === 'function' && typeof elyby === 'object') {
      await elybyRefresh();
      S.loggedIn = !!elyby.loggedIn;
      S.nick = elyby.nick || '';
      return;
    }
    // Без app.js (страница открыта отдельно) считаем, что вход неизвестен
    S.loggedIn = false;
    S.nick = '';
  }

  // ── Каталог ───────────────────────────────────────────────────────────────

  async function loadPage(next) {
    if (S.loading) return;
    S.loading = true;
    if (next) S.page += 1;
    else { S.page = 1; S.all = []; }
    renderBody();

    try {
      const url = API + '/api/elyby/catalog?page=' + S.page
                + '&safe=' + (S.safe ? '1' : '0')
                + (S.q ? '&q=' + encodeURIComponent(S.q) : '');
      const r = await fetch(url);
      const d = await r.json();
      if (!d || !d.ok) throw new Error('bad response');

      S.all = S.all.concat(d.items || []);
      S.last = d.last || 1;
      S.total = d.total || 0;
      // Скрытое считаем накопительно: иначе счётчик скакал бы при листании
      S.hidden = next ? S.hidden + (d.hidden || 0) : (d.hidden || 0);
    } catch (e) {
      say(tr('skins.failed', tr('skins.failed', 'Не удалось загрузить каталог')), 'err');
    }
    S.loading = false;
    renderBody();
  }

  /**
   * Что показываем прямо сейчас.
   *
   * Отбор по крою делается здесь, а не запросом: ely.by такого параметра не
   * знает. Поэтому «классические» и «тонкие» режут уже загруженное — иначе на
   * каждой смене фильтра пришлось бы идти в сеть.
   */
  function visible() {
    if (S.slim === 'slim')    return S.all.filter((s) => s.slim);
    if (S.slim === 'classic') return S.all.filter((s) => !s.slim);
    return S.all;
  }

  // ── Надевание ─────────────────────────────────────────────────────────────

  /**
   * Надеть скин на аккаунт ely.by.
   *
   * Сам запрос делает окно (window.pulse.elybyWear) — у него сессия. Отказ
   * приходит кодом 200 с полем error, поэтому смотрим поле, а не статус.
   */
  async function wear(id) {
    if (!window.pulse || typeof window.pulse.elybyWear !== 'function') {
      say(tr('skins.needLauncher', tr('skins.needLauncher', 'Надеть скин можно только в лаунчере')), 'err');
      return;
    }
    if (!S.loggedIn) {
      say(tr('skins.needLogin', tr('skins.needLogin', 'Сначала войди на ely.by')), 'err');
      return;
    }

    let res;
    try {
      res = await window.pulse.elybyWear(id);
    } catch (_) {
      res = { ok: false, error: 'error_network' };
    }

    if (!res || !res.ok) {
      const err = (res && res.error) || '';
      if (err === 'error_login') {
        // Сессия протухла или её нет: предлагаем войти, а не молчим
        say(tr('skins.sessionLost', tr('skins.sessionLost', 'Сессия ely.by истекла — войди заново')), 'err');
        S.loggedIn = false;
        renderHead();
      } else {
        say(tr('skins.wearFailed', tr('skins.wearFailed', 'Не удалось надеть скин')), 'err');
      }
      return;
    }

    S.wornId = id;
    renderBody();
    say(tr('skins.worn', tr('skins.worn', 'Скин надет')), 'ok');

    // Хеш — из списка: в кнопке лежит только id, а показать надо ту самую
    // картинку, которую игрок выбрал (см. dressUp)
    const skin = S.all.find((s) => s.id === id);
    await dressUp(skin ? skin.hash : '');
  }

  /**
   * Довести надевание до экрана.
   *
   * Скин ушёл на аккаунт ely.by, а играть игрок может под другим профилем — и
   * тогда он не увидит ровно ничего, а решит, что кнопка не работает. Ровно на
   * этом и спотыкались: скин надевался, а на аватаре и Стиве в диораме
   * оставался прежний.
   *
   * Поэтому два шага и именно в этом порядке:
   *   1. записать нику тот скин, который игрок выбрал;
   *   2. переключиться на ник ely.by, если играем под другим. Профиль к этому
   *      моменту уже заведён (панель аккаунтов открывали — она и создала).
   *
   * Первый шаг — именно запись по хешу, а не перечитывание, и это не мелочь.
   * Файл скина по нику ely.by отдаёт с задержкой в минуты: проверено живьём —
   * учётка приняла новый скин сразу, а файл по нику показывал прежний ещё шесть
   * минут. Перечитав, мы запомнили бы прежний на сутки, и «надел, а не
   * поменялось» осталось бы, только по другой причине.
   */
  async function dressUp(hash) {
    const nick = S.nick;
    if (!nick) return;

    // Профиль мог не завестись, если в этой сессии панель аккаунтов не открыли
    if (typeof syncElybyAccount === 'function') await syncElybyAccount();

    if (hash && typeof adoptWornSkin === 'function') await adoptWornSkin(nick, hash);
    else if (typeof refreshSkinOf === 'function') await refreshSkinOf(nick, true);

    if (typeof accounts === 'undefined' || !Array.isArray(accounts)) return;
    if (typeof selectAccount !== 'function' || typeof activeAccountId !== 'string') return;
    const acc = accounts.find((a) => a.name && a.name.toLowerCase() === nick.toLowerCase());
    if (acc && acc.id !== activeAccountId) await selectAccount(acc.id);
  }

  // ── Отрисовка ─────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function renderHead() {
    const el = $('#skAccount');
    if (!el) return;
    if (S.loggedIn) {
      el.innerHTML =
        '<span class="sk-dot sk-dot--on"></span>'
        + '<span>' + esc(tr('skins.loggedAs', tr('skins.loggedAs', 'Вошёл как'))) + ' <b>' + esc(S.nick) + '</b></span>'
        + '<button class="ghost-btn sk-mini" data-sk="logout">'
        + esc(tr('skins.relogin', tr('skins.relogin', 'Сменить'))) + '</button>';
    } else {
      el.innerHTML =
        '<span class="sk-dot"></span>'
        + '<span>' + esc(tr('skins.notLogged', tr('skins.notLogged', 'Вход на ely.by не выполнен'))) + '</span>'
        + '<button class="ghost-btn sk-mini" data-sk="login">'
        + esc(tr('skins.login', tr('skins.login', 'Войти'))) + '</button>';
    }
  }

  function card(s) {
    const worn = S.wornId === s.id;
    const tags = (s.tags || []).slice(0, 3);
    return ''
      + '<div class="sk-card' + (worn ? ' sk-card--worn' : '') + '" data-id="' + s.id + '">'
      +   '<div class="sk-face" style="background-image:url(\'' + previewUrl(s.hash) + '\')"'
      +        ' data-sk="preview" data-hash="' + esc(s.hash) + '" data-id="' + s.id + '"></div>'
      +   '<div class="sk-meta">'
      +     '<div class="sk-tags">'
      +       (s.slim ? '<span class="sk-tag sk-tag--slim">Alex</span>' : '')
      +       (s.adult ? '<span class="sk-tag sk-tag--18">18+</span>' : '')
      +       tags.map((tg) => '<span class="sk-tag">' + esc(tg) + '</span>').join('')
      +     '</div>'
      +     '<div class="sk-wearers">' + num(s.wearers) + '</div>'
      +   '</div>'
      +   '<button class="ghost-btn sk-wear" data-sk="wear" data-id="' + s.id + '">'
      +     esc(worn ? tr('skins.wornShort', tr('skins.wornShort', 'Надет')) : tr('skins.wear', tr('skins.wear', 'Надеть')))
      +   '</button>'
      + '</div>';
  }

  function renderBody() {
    const body = $('#skBody');
    if (!body) return;

    const items = visible();
    let html = '';
    if (S.loading && !items.length) {
      html = '<div class="sk-empty">' + esc(tr('skins.loading', tr('skins.loading', 'Загружаем…'))) + '</div>';
    } else if (!items.length) {
      html = '<div class="sk-empty">' + esc(tr('skins.empty', tr('skins.empty', 'Ничего не нашлось'))) + '</div>';
    } else {
      html = '<div class="sk-grid">' + items.map(card).join('') + '</div>';

      const parts = [];
      if (S.page < S.last) {
        parts.push('<button class="ghost-btn sk-more" data-sk="more">'
                 + esc(tr('skins.more', tr('skins.more', 'Показать ещё'))) + '</button>');
      }
      // Говорим, сколько спрятано: молча урезанная выдача выглядит как «их тут
      // и не было», и человек не догадается, что дело в фильтре
      if (S.safe && S.hidden > 0) {
        parts.push('<div class="sk-hidden">'
                 + esc(tr('skins.hidden', tr('skins.hidden', 'Скрыто фильтром 18+'))) + ': ' + S.hidden
                 + '</div>');
      }
      parts.push('<div class="sk-total">' + esc(tr('skins.total', tr('skins.total', 'Всего в каталоге')))
               + ': ' + num(S.total) + '</div>');
      html += '<div class="sk-foot">' + parts.join('') + '</div>';
    }
    body.innerHTML = html;
  }

  // ── Просмотр целиком ──────────────────────────────────────────────────────

  /**
   * Скин целиком — вращающейся моделью.
   *
   * Раньше здесь была развёртка картинкой. Она показывает текстуру, но не
   * показывает, как та сидит на фигуре: где шов, где второй слой, что со
   * спины. Поэтому теперь модель из коробок, которую можно крутить мышью
   * (см. skinview.js — он собирает её из тех же примитивов, что и диорама).
   */
  let viewer = null;

  function openPreview(hash, id) {
    const box = $('#skPreview');
    if (!box) return;

    // Тонкий ли скин, знает только список: в окно приходит один хеш
    const skin = S.all.find((s) => s.id === id) || {};
    const tags = (skin.tags || []);

    box.innerHTML =
      '<div class="sk-pv-inner">'
      +  '<canvas class="sk-pv-3d" id="skPvCanvas"></canvas>'
      +  '<div class="sk-pv-side">'
      +    '<div class="sk-pv-tags">'
      +      (skin.slim ? '<span class="sk-tag sk-tag--slim">Alex</span>'
                         : '<span class="sk-tag">Steve</span>')
      +      (skin.adult ? '<span class="sk-tag sk-tag--18">18+</span>' : '')
      +      tags.map((tg) => '<span class="sk-tag">' + esc(tg) + '</span>').join('')
      +    '</div>'
      +    '<div class="sk-pv-wearers">'
      +      esc(tr('skins.wearers', tr('skins.wearers', 'Носят'))) + ': ' + num(skin.wearers || 0)
      +    '</div>'
      +    '<div class="sk-pv-hint">'
      +      esc(tr('skins.dragHint', tr('skins.dragHint', 'Потяни мышью, чтобы повернуть')))
      +    '</div>'
      +    '<div class="sk-pv-actions">'
      +      '<button class="ghost-btn sk-wear" data-sk="wear" data-id="' + id + '">'
      +        esc(tr('skins.wear', tr('skins.wear', 'Надеть'))) + '</button>'
      +      '<button class="ghost-btn" data-sk="pv-close">'
      +        esc(tr('skins.close', tr('skins.close', 'Закрыть'))) + '</button>'
      +    '</div>'
      +  '</div>'
      + '</div>';
    box.style.display = 'flex';

    closeViewer();
    const canvas = $('#skPvCanvas');
    if (canvas && typeof SkinView !== 'undefined') {
      viewer = SkinView.mount(canvas, previewUrl(hash), !!skin.slim);
    } else if (canvas) {
      // Без skinview.js (старый кэш страницы) показываем хотя бы развёртку
      canvas.outerHTML = '<img class="sk-pv-img" src="' + previewUrl(hash) + '" alt="">';
    }
  }

  function closeViewer() {
    if (viewer) { viewer.destroy(); viewer = null; }
  }

  function closePreview() {
    closeViewer();
    const box = $('#skPreview');
    if (box) { box.style.display = 'none'; box.innerHTML = ''; }
  }

  // ── Открытие и закрытие ───────────────────────────────────────────────────

  async function openSkins() {
    const m = $('#skinsModal');
    if (!m) return;
    m.style.display = 'flex';
    S.open = true;
    await loadState();
    renderHead();
    if (!S.all.length) loadPage(false);
    else renderBody();
  }

  function closeSkins() {
    const m = $('#skinsModal');
    if (m) m.style.display = 'none';
    S.open = false;
    closePreview();
  }

  function onBackdrop(e) {
    if (e.target && e.target.id === 'skinsModal') closeSkins();
  }

  // ── События ───────────────────────────────────────────────────────────────

  function bind() {
    const m = $('#skinsModal');
    if (!m) return;
    m.addEventListener('click', (e) => {
      const t0 = e.target.closest('[data-sk]');
      if (!t0) return;
      const act = t0.dataset.sk;

      if (act === 'close') { closeSkins(); return; }
      if (act === 'pv-close') { closePreview(); return; }
      if (act === 'more') { loadPage(true); return; }
      if (act === 'wear') { wear(parseInt(t0.dataset.id, 10)); return; }
      if (act === 'preview') { openPreview(t0.dataset.hash, parseInt(t0.dataset.id, 10)); return; }
      if (act === 'login') {
        if (window.pulse && window.pulse.openElyBy) window.pulse.openElyBy('login');
        return;
      }
      if (act === 'logout') {
        if (window.pulse && window.pulse.openElyBy) window.pulse.openElyBy('login');
        return;
      }
    });

    // Клик мимо панели закрывает предпросмотр. Внутрь панели щёлкать можно
    // сколько угодно — там модель, её крутят мышью, и закрывать её от каждого
    // нажатия было бы невозможно пользоваться.
    const pv = $('#skPreview');
    if (pv) {
      pv.addEventListener('click', (e) => { if (e.target === pv) closePreview(); });
    }

    const search = $('#skSearch');
    if (search) {
      search.addEventListener('input', () => {
        // Пауза перед запросом: иначе на каждую букву уходил бы запрос к ely.by
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          S.q = search.value.trim();
          loadPage(false);
        }, 450);
      });
    }

    const safe = $('#skSafe');
    if (safe) {
      safe.addEventListener('change', () => {
        S.safe = safe.checked;
        loadPage(false);
      });
    }

    const slim = $('#skSlim');
    if (slim) {
      slim.addEventListener('change', () => {
        S.slim = slim.value;
        // Отбор по крою идёт при отрисовке, так что достаточно перерисовать
        renderBody();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if ($('#skPreview') && $('#skPreview').style.display === 'flex') { closePreview(); return; }
      if (S.open) closeSkins();
    });

    // Смена языка перерисовывает статику сама, а вот надписи, собранные в JS
    // (шапка с ником, кнопки «Надеть»), остались бы на прежнем языке.
    if (window.I18N && typeof window.I18N.onChange === 'function') {
      window.I18N.onChange(() => {
        if (!S.open) return;
        renderHead();
        renderBody();
      });
    }
  }

  // Наружу — только то, что зовут из разметки
  window.openSkins = openSkins;
  window.closeSkins = closeSkins;
  window.onSkinsBackdrop = onBackdrop;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
