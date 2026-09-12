/* ── Плавная прокрутка списка версий ──────────────────────────────────────────
   Порт SmoothScroll v1.4.10 (Balazs Galambosi, MIT). Взято главное, за что он
   и нравится: функция easing pulse() Майкла Херфа и очередь прокруток вместо
   одиночной анимации.

   Смысл pulse(): щелчок колеса — это не равномерный проезд, а толчок с
   разгоном и вязким затуханием, как если бы список двигали по густой смазке.
   Несколько щелчков подряд складываются в очередь и складываются в скорость,
   поэтому быстрый скролл разгоняется, а не дёргается рывками.

   Что выброшено из оригинала: клавиатура, MutationObserver и хаки под старые
   Safari — в Electron они не нужны. Буфер дельт живёт в памяти, а не в
   localStorage. Прокрутка привязана к одному элементу, а не к странице.
*/

(function () {
  'use strict';

  // ── Настройки ──────────────────────────────────────────────────────────────
  const ANIM_MS = 400;        // длительность одной прокрутки, мс
  const STEP = 100;           // пикселей за один щелчок колеса
  const ACCEL_WINDOW = 50;    // окно, в котором щелчки считаются серией, мс
  const ACCEL_MAX = 3;        // во сколько раз максимум разгоняем серию
  const MIN_DELTA = 1.2;      // ниже этого дельту не масштабируем
  const TOUCHPAD_MIN = 50;    // дельта меньше — точно тачпад

  /* ── pulse: вязкая жидкость с толчком (Michael Herf) ────────────────────────
     До y = 1 идёт разгон по y - (1 - e^-y), дальше — экспоненциальный хвост из
     «вязкого» торможения. Кривая быстро набирает ход и долго, асимптотически
     подползает к цели: ни рывка на старте, ни удара в конце.

     Аргумент здесь уже умножен на PULSE_SCALE — так же, как в оригинале, где
     pulse_() первым делом делает x *= pulseScale. */
  const PULSE_SCALE = 4;      // доля времени на разгон: 1/4 анимации

  function pulseRaw(y) {
    if (y < 1) return y - (1 - Math.exp(-y));
    const start = Math.exp(-1);
    return start + (1 - Math.exp(-(y - 1))) * (1 - start);
  }

  /* Нормируем по значению в КОНЦЕ анимации, то есть по pulseRaw(PULSE_SCALE),
     а не по pulseRaw(1). Ошибка здесь стоила бы дорого: кривая успевала дойти
     до цели за первую четверть времени, дальше уходила в перелёт на полтора
     экрана и её приходилось силой возвращать назад последним кадром. */
  const NORM = 1 / pulseRaw(PULSE_SCALE);

  function pulse(x) {
    if (x >= 1) return 1;
    if (x <= 0) return 0;
    return pulseRaw(x * PULSE_SCALE) * NORM;
  }

  function create(elem) {
    if (!elem) return null;

    let que = [];
    let pending = false;
    let last = 0;               // время последнего щелчка, для разгона
    let dirX = 0, dirY = 0;

    /* ── Тачпад ───────────────────────────────────────────────────────────────
       Мышь на Windows всегда шлёт дельту, кратную 100 или 120. Тачпад — мелкий
       дробный поток. Ему своё сглаживание не нужно: Chromium уже даёт инерцию,
       а вторая сглаживающая поверх первой ощущается как залипание. */
    const buf = [];
    const divisible = (n, d) => Math.floor(n / d) === n / d;
    const allDivisible = (d) => buf.length === 3 && buf.every((v) => divisible(v, d));

    function isTouchpad(delta) {
      if (!delta) return false;
      const a = Math.abs(delta);
      buf.push(a);
      if (buf.length > 3) buf.shift();
      if (a < TOUCHPAD_MIN) return true;
      if (buf.length < 3) return false;
      return !allDivisible(120) && !allDivisible(100) && !(a > 120 && allDivisible(a));
    }

    /* ── Очередь прокруток ────────────────────────────────────────────────────
       Каждый щелчок — отдельное задание со своим временем старта. Задания
       живут параллельно, поэтому новая прокрутка не обрывает предыдущую,
       а накладывается на неё. */
    function step() {
      const now = Date.now();
      let sx = 0, sy = 0;

      for (let i = 0; i < que.length; i++) {
        const item = que[i];
        const elapsed = now - item.start;
        const finished = elapsed >= ANIM_MS;
        const pos = finished ? 1 : pulse(elapsed / ANIM_MS);

        // Нужна только разница с прошлым кадром. `>> 0` вместо round —
        // как в оригинале: дробные пиксели всё равно не отрисуются.
        const x = (item.x * pos - item.lastX) >> 0;
        const y = (item.y * pos - item.lastY) >> 0;

        sx += x; sy += y;
        item.lastX += x; item.lastY += y;

        if (finished) { que.splice(i, 1); i--; }
      }

      if (sx) elem.scrollLeft += sx;
      if (sy) elem.scrollTop += sy;

      if (que.length) requestAnimationFrame(step);
      else pending = false;
    }

    function scrollBy(x, y) {
      // Разворот колеса обнуляет очередь. Без этого накопленный разгон тащит
      // список дальше, хотя пользователь уже поехал в обратную сторону.
      const sx = x > 0 ? 1 : -1;
      const sy = y > 0 ? 1 : -1;
      if (dirX !== sx || dirY !== sy) { dirX = sx; dirY = sy; que = []; last = 0; }

      const now = Date.now();
      const elapsed = now - last;
      if (elapsed > 0 && elapsed < ACCEL_WINDOW) {
        const f = Math.min((1 + ACCEL_WINDOW / elapsed) / 2, ACCEL_MAX);
        if (f > 1) { x *= f; y *= f; }
      }
      last = now;

      // lastX/lastY начинаются не с нуля, а с ±0.99 — иначе первый кадр
      // анимации округляется до нуля и прокрутка стартует с задержкой.
      que.push({
        x, y,
        lastX: x < 0 ? 0.99 : -0.99,
        lastY: y < 0 ? 0.99 : -0.99,
        start: now
      });

      if (!pending) { pending = true; requestAnimationFrame(step); }
    }

    function onWheel(e) {
      if (e.defaultPrevented || e.ctrlKey) return;   // ctrl+колесо — это зум

      let dx = -e.wheelDeltaX || e.deltaX || 0;
      let dy = -e.wheelDeltaY || e.deltaY || 0;
      if (!dx && !dy) dy = -e.wheelDelta || 0;
      if (e.deltaMode === 1) { dx *= 40; dy *= 40; }  // построчная прокрутка

      // Список целиком помещается на экран — не перехватываем событие,
      // пусть колесо уходит дальше по странице.
      if (elem.scrollHeight <= elem.clientHeight + 10) return;
      if (isTouchpad(dy)) return;

      if (Math.abs(dx) > MIN_DELTA) dx *= STEP / 120;
      if (Math.abs(dy) > MIN_DELTA) dy *= STEP / 120;

      scrollBy(dx, dy);
      e.preventDefault();
    }

    elem.addEventListener('wheel', onWheel, { passive: false });

    return {
      destroy() { elem.removeEventListener('wheel', onWheel); que = []; }
    };
  }

  window.SmoothScroll = { create };

  // Список версий перерисовывается через innerHTML, но сам контейнер
  // #versionList живёт всё время — обработчик вешаем на него один раз.
  if (!window.SMOOTH_SCROLL_TEST_MANUAL) {
    window.addEventListener('DOMContentLoaded', () => {
      create(document.getElementById('versionList'));
    });
  }
})();
