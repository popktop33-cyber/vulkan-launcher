/* ── SplitText + ScrambleText: символы рассыпаются под курсором ───────────────
   Порт дизайна из smoths-scroll/Новая папка. Логика та же: текст режется на
   символы, и каждый символ ближе RADIUS к курсору начинает мерцать мусорными
   глифами, а потом собирается обратно. Чем ближе курсор, тем дольше мерцание
   (в дизайне — 1.2 − dist/100 секунды).

   GSAP и SplitText из оригинала не тянем: SplitText — платный плагин, а GSAP
   это ещё 70 КБ на машины, где лаунчер и без него еле дышит. Здесь то же самое
   на голом DOM.

   Три вещи, без которых эффект выглядел бы сломанным:

   1. Ширина символа фиксируется. Если её не закрепить, подмена «W» на «.»
      перекраивает всю строку — заголовок в 52px дёргается целиком.
   2. Истинный символ живёт в data-ch, а не в тексте узла. Подмена глифа и
      пересборка (смена вкладки, resize) не могут испортить текст.
   3. Замер и запись ширин разнесены на два прохода — иначе каждая запись
      сбрасывает раскладку и следующий замер стоит нового пересчёта.
*/

(function () {
  'use strict';

  // ── Настройки (значения из дизайна) ────────────────────────────────────────
  const RADIUS = 100;         // px, радиус реакции на курсор
  const RADIUS2 = RADIUS * RADIUS;
  const NOISE = '.:';         // из чего собирается мусор
  const LONGEST = 1200;       // мс мерцания вплотную к курсору (1.2 с)
  const SHORTEST = 200;       // мс на границе радиуса (0.2 с)
  const STEP_MS = 45;         // как часто подменяется глиф

  // Только эти тексты. Список закрытый: эффект на кнопках и списке версий
  // превратил бы интерфейс в рябь.
  const TARGETS = [
    '#logoText',        // vulkan_
    '#brandVersion',    // 1.21.4 - Fabric
    '#profileName',     // никнейм
    '#profileMeta',     // vulkan · локальный профиль
    '#heroTitle',       // Vanilla mode.
    '#heroText'         // Pure Minecraft profile with isolated clean files…
  ];

  const units = [];           // { el, chars: [{ node, cx, cy }] }
  const live = new Map();     // span -> { until, next }
  let raf = 0;
  let moveRaf = 0;
  let pointer = null;
  let resizeTimer = 0;

  /* ── Разбор текста на символы ───────────────────────────────────────────────
     Слово заворачиваем в обёртку с nowrap, и это не украшение. Каждый символ —
     отдельный inline-block, а между двумя atomic inline браузеру разрешено
     переносить строку: без обёртки длинная строка рвёт слова посередине, а не
     по пробелам. Пробелы остаются текстовыми узлами — они и есть точки
     переноса.

     Элементы внутри (мигающий курсор в логотипе) не трогаем — иначе сломали
     бы его анимацию. */
  function split(el) {
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType !== 3) continue;
      if (!node.nodeValue.trim()) continue;

      const frag = document.createDocumentFragment();
      for (const part of node.nodeValue.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); continue; }

        const word = document.createElement('span');
        word.className = 'scr-word';
        for (const ch of part) {
          const span = document.createElement('span');
          span.className = 'scr-char';
          span.dataset.ch = ch;      // единственный источник правды о символе
          span.textContent = ch;
          word.appendChild(span);
        }
        frag.appendChild(word);
      }
      el.replaceChild(frag, node);
    }
  }

  /* ── Замер ─────────────────────────────────────────────────────────────────
     Два прохода: сначала сбрасываем все ширины, потом одним заходом читаем
     прямоугольники. Мешать чтение с записью нельзя — каждое style.width
     помечает раскладку грязной и следующий замер пересчитывает её заново. */
  function layout(unit) {
    const chars = Array.from(unit.el.querySelectorAll('.scr-char'));
    for (const c of chars) c.style.width = '';

    const rects = chars.map((c) => c.getBoundingClientRect());

    unit.chars = [];
    for (let i = 0; i < chars.length; i++) {
      const r = rects[i];
      if (!r.width) continue;    // элемент скрыт — вернёмся после refresh()
      chars[i].style.width = r.width + 'px';
      unit.chars.push({
        node: chars[i],
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2
      });
    }
  }

  /* ── Пересборка ─────────────────────────────────────────────────────────────
     Перед ней обязательно возвращаем настоящие символы: иначе мусорный глиф
     попадёт в текст, а оттуда — в data-ch следующей пересборки. */
  function rebuild(unit) {
    for (const node of Array.from(live.keys())) {
      if (!node.isConnected) { live.delete(node); continue; }
      if (unit.el.contains(node)) { node.textContent = node.dataset.ch; live.delete(node); }
    }
    split(unit.el);
    layout(unit);
  }

  /* ── Мерцание ───────────────────────────────────────────────────────────────
     Кадры крутятся только пока есть что мерцать: неподвижный курсор не
     оставляет ни одного запроса на кадр. */
  function tick(now) {
    raf = 0;
    let alive = false;

    for (const [node, st] of live) {
      if (now >= st.until) {
        node.textContent = node.dataset.ch;
        live.delete(node);
        continue;
      }
      alive = true;
      if (now >= st.next) {
        node.textContent = NOISE[(Math.random() * NOISE.length) | 0];
        st.next = now + STEP_MS * (0.6 + Math.random() * 0.8);
      }
    }

    if (alive) raf = requestAnimationFrame(tick);
  }

  function applyPointer() {
    moveRaf = 0;
    if (!pointer) return;

    const now = performance.now();
    const x = pointer.x;
    const y = pointer.y;

    for (const unit of units) {
      for (const c of unit.chars) {
        const dx = x - c.cx;
        const dy = y - c.cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > RADIUS2) continue;

        const ms = LONGEST - (Math.sqrt(d2) / RADIUS) * (LONGEST - SHORTEST);
        // Повторный заход только продлевает мерцание — так же, как
        // overwrite: true в дизайне. Символ не «перезапускается».
        live.set(c.node, { until: now + ms, next: 0 });
      }
    }

    if (live.size && !raf) raf = requestAnimationFrame(tick);
  }

  function onMove(e) {
    pointer = { x: e.clientX, y: e.clientY };
    if (!moveRaf) moveRaf = requestAnimationFrame(applyPointer);
  }

  /* ── Пересчёт координат ─────────────────────────────────────────────────────
     Координаты символов кэшируются, поэтому их надо обновлять, когда вёрстка
     поехала: resize, смена вкладки или режима, прокрутка. */
  function refresh() {
    for (const unit of units) {
      if (!unit.el.isConnected) continue;
      rebuild(unit);
    }
  }

  function scheduleRefresh() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(refresh, 150);
  }

  function attach(el) {
    const unit = { el, chars: [] };
    units.push(unit);

    split(el);
    layout(unit);

    /* Наблюдаем только childList. app.js переписывает тексты через
       textContent — это как раз childList, и его надо поймать. А подмена
       глифов идёт через characterData внутри span, и её мы намеренно не
       слушаем: иначе собственное мерцание запускало бы пересборку каждый кадр. */
    const obs = new MutationObserver(() => {
      obs.disconnect();
      rebuild(unit);
      obs.observe(el, { childList: true });
    });
    obs.observe(el, { childList: true });
    unit.obs = obs;
  }

  function init() {
    for (const sel of TARGETS) {
      const el = document.querySelector(sel);
      if (el) attach(el);
    }
    if (!units.length) return;

    document.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('resize', scheduleRefresh);
    document.addEventListener('scroll', scheduleRefresh, true);

    // Ширина символа зависит от шрифта, а он может доехать позже
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh);
  }

  window.Scramble = { refresh, get ready() { return units.length > 0; } };

  if (!window.SCRAMBLE_TEST_MANUAL) {
    window.addEventListener('DOMContentLoaded', init);
  }
})();
