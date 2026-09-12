'use strict';
/*
 * Визуальные эффекты лаунчера.
 *
 * 1. Волна по клику — настоящая симуляция волнового уравнения на сетке.
 *    Элементы интерфейса задают в ней более плотную среду: волна проходит
 *    сквозь них, слегка замедляясь и изламываясь, а не отбивается от стенки.
 *
 * 2. Фон при наведении — трава в режиме Vanilla и небула в режиме чита.
 *    Рисуется одним общим холстом, который переезжает в наведённую кнопку,
 *    поэтому анимация всегда одна и не зависит от числа кнопок.
 *    Часы у эффекта общие и идут непрерывно: наведение только показывает
 *    анимацию, а не запускает её заново.
 *
 * Оба уважают prefers-reduced-motion.
 */

const FX = (() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Уровень производительности выставлен в <head> до первой отрисовки
  const TIER = document.documentElement.dataset.perf || 'high';
  const LOW = TIER === 'low';
  const MID = TIER === 'mid';

  // ── Палитры: фиолетовая для чита, зелёная для Vanilla ─────────────────────
  const PALETTES = {
    pulse: {
      wave: [[124, 92, 255], [186, 160, 255]],
      grass: null,
      nebula: [[124, 92, 255], [92, 132, 255], [186, 120, 255], [80, 60, 190]]
    },
    vanilla: {
      wave: [[77, 178, 102], [168, 241, 183]],
      grass: { blade: [96, 200, 118], tip: [186, 245, 190], dark: [28, 88, 46] },
      nebula: null
    }
  };

  function palette() {
    return document.body.classList.contains('vanilla-mode') ? PALETTES.vanilla : PALETTES.pulse;
  }

  // ── Волновое поле ─────────────────────────────────────────────────────────
  //
  // Дискретное волновое уравнение: u' = 2u − u₋ + k·(Σсоседей − 4u), домноженное
  // на затухание. k ≤ 0.5 — условие устойчивости в 2D, берём с запасом.
  // Препятствия держим нулём: сосед видит их как «дно» и волна отбивается.

  // На слабой машине сетку берём крупнее: колец чуть меньше, зато кадры дешевле.
  // Считается один раз при загрузке — уровень не меняется на ходу.
  const CELL = LOW ? 9 : MID ? 7 : 5;
  const K = 0.28;       // жёсткость; больше 0.5 — схема разваливается
  const DAMP = 0.978;   // затухание за шаг; волна живёт около 4 секунд
  const SLEEP = 0.2;    // ниже этого порога поле не видно — цикл засыпает
  const RING_GAIN = 0.18; // усиление крутизны при отрисовке кольца

  // Среда внутри элементов интерфейса. Волна НЕ отбивается от них, а проходит
  // насквозь, слегка замедляясь и теряя амплитуду: на границе среду меняется
  // жёсткость, из-за чего фронт чуть изламывается и оставляет за собой след.
  const K_INSIDE = K * 0.40;   // внутри волна идёт заметно медленнее
  const DAMP_INSIDE = 0.970;   // и чуть быстрее затухает

  class WaveField {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: true });
      this.cols = 0;
      this.rows = 0;
      this.cur = null;
      this.prev = null;
      this.next = null;
      this.solid = null;
      this.img = null;
      this.host = document.createElement('canvas');
      this.hostCtx = this.host.getContext('2d');
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.resize();
    }

    resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.canvas.width = Math.floor(w * this.dpr);
      this.canvas.height = Math.floor(h * this.dpr);
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';

      this.cols = Math.max(2, Math.ceil(w / CELL) + 2);
      this.rows = Math.max(2, Math.ceil(h / CELL) + 2);
      this.host.width = this.cols;
      this.host.height = this.rows;
      this.img = this.hostCtx.createImageData(this.cols, this.rows);
      this.active = false;

      const n = this.cols * this.rows;
      this.cur = new Float32Array(n);
      this.prev = new Float32Array(n);
      this.next = new Float32Array(n);
      this.solid = new Uint8Array(n);
    }

    /**
     * Затирает прямоугольники интерактивных элементов в маску препятствий.
     * Вызывается не каждый кадр: геометрия меняется редко.
     */
    buildObstacles() {
      this.solid.fill(0);
      // Закрытая панель аккаунтов в список не входит намеренно: она невидима,
      // но занимает правую часть окна — волна билась о несуществующий кубик.
      const nodes = document.querySelectorAll(
        'button, .account-row, .version-item, .mod-card, .setting-row, .hero-card, .music-card'
      );
      for (const el of nodes) {
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) continue;
        // Прозрачные и скрытые элементы тоже пропускаем — иначе в поле появляются
        // препятствия, которых на экране нет
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) continue;

        const x0 = Math.max(0, Math.floor(r.left / CELL));
        const x1 = Math.min(this.cols - 1, Math.ceil(r.right / CELL));
        const y0 = Math.max(0, Math.floor(r.top / CELL));
        const y1 = Math.min(this.rows - 1, Math.ceil(r.bottom / CELL));
        for (let y = y0; y <= y1; y++) {
          const row = y * this.cols;
          for (let x = x0; x <= x1; x++) this.solid[row + x] = 1;
        }
      }
    }

    /** Толчок в точке экрана. */
    pulse(clientX, clientY, strength = 1) {
      this.active = true;   // цикл спит, пока поле не возмутят — будим здесь
      const cx = Math.round(clientX / CELL) + 1;
      const cy = Math.round(clientY / CELL) + 1;
      // Радиус задаём в пикселях и переводим в клетки: при смене CELL
      // физический размер толчка не должен меняться.
      const radius = Math.max(2, Math.round(14 / CELL));
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 1 || y < 1 || x >= this.cols - 1 || y >= this.rows - 1) continue;
          const d = Math.hypot(dx, dy);
          if (d > radius) continue;
          // Толчок кладём ВЕЗДЕ, в том числе внутрь элементов. Раньше клетки
          // под кнопками пропускались, и клик по кнопке не давал волны вовсе.
          const i = y * this.cols + x;
          // Плавный колокол: резкий край даёт квадратную волну и грязь в кольцах
          const f = Math.cos((d / radius) * Math.PI * 0.5);
          this.cur[i] += strength * 26 * f * f;
        }
      }
    }

    step() {
      const { cols, rows, cur, prev, next, solid } = this;
      // Пик считаем прямо здесь, а не отдельным проходом по каждой N-й клетке:
      // при разреженной выборке толчок мог не попасть в неё, поле признавалось
      // успокоившимся, и волна не отрисовывалась вовсе.
      let peak = 0;
      for (let y = 1; y < rows - 1; y++) {
        const row = y * cols;
        for (let x = 1; x < cols - 1; x++) {
          const i = row + x;
          // Внутри элементов среда плотнее: волна идёт медленнее и слабее.
          // Ноль сюда не ставим — именно поэтому фронт проходит сквозь,
          // а не отбивается, как от стенки.
          const inside = solid[i];
          const k = inside ? K_INSIDE : K;
          const damp = inside ? DAMP_INSIDE : DAMP;
          const n = cur[i - 1] + cur[i + 1] + cur[i - cols] + cur[i + cols];
          let v = (2 * cur[i] - prev[i] + k * (n - 4 * cur[i])) * damp;
          if (v > 60) v = 60; else if (v < -60) v = -60;
          next[i] = v;
          const a = v < 0 ? -v : v;
          if (a > peak) peak = a;
        }
      }
      this.prev = cur;
      this.cur = next;
      this.next = prev;
      this.active = peak > SLEEP;
    }

    clear() {
      this.cur.fill(0);
      this.prev.fill(0);
      this.next.fill(0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    render() {
      const { cols, rows, cur, img } = this;
      const pal = palette().wave;
      const [cr, cg, cb] = pal[0];
      const [hr, hg, hb] = pal[1];
      const data = img.data;

      for (let y = 0; y < rows; y++) {
        const row = y * cols;
        for (let x = 0; x < cols; x++) {
          const i = row + x;
          const p = i * 4;
          if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) {
            data[p + 3] = 0;
            continue;
          }

          // Рисуем не высоту поля, а КРУТИЗНУ склона. У бегущей волны она
          // максимальна ровно на фронте, поэтому получаются тонкие отдельные
          // кольца. Отрисовка самой высоты давала мутные пятна.
          const gx = cur[i + 1] - cur[i - 1];
          const gy = cur[i + cols] - cur[i - cols];
          const g = Math.sqrt(gx * gx + gy * gy);

          let a = g * RING_GAIN;
          if (a > 1) a = 1;
          if (a < 0.04) { data[p + 3] = 0; continue; }
          a = a * a * (3 - 2 * a);   // сглаженный порог: край мягкий, кольцо тонкое

          // Гребень уходит в светлый тон, впадина в тёмный — это и есть переливание
          const u = cur[i];
          const t = u > 0 ? Math.min(1, u * 0.09) : 0;
          data[p] = cr + (hr - cr) * t;
          data[p + 1] = cg + (hg - cg) * t;
          data[p + 2] = cb + (hb - cb) * t;
          data[p + 3] = Math.round(a * 240);
        }
      }

      this.hostCtx.putImageData(img, 0, 0);
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.host, 0, 0, this.canvas.width, this.canvas.height);
    }
  }

  // ── Фон при наведении ─────────────────────────────────────────────────────
  //
  // Один общий холст переезжает под курсор. Это дешевле, чем держать анимацию
  // в каждой кнопке, и гарантирует, что эффект всегда ровно один.

  class HoverFx {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.host = null;
      this.kind = null;      // 'grass' | 'nebula'
      this.clock = 0;        // общие часы эффекта — идут непрерывно, не сбрасываются
      this.blades = [];
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    }

    attach(host) {
      // Список аккаунтов перерисовывается из JS, и старый host может оказаться
      // выброшенным из документа — тогда считаем, что хоста нет.
      if (this.host && !this.host.isConnected) this.host = null;
      if (host && !host.isConnected) host = null;

      // Уход с кнопки: холст остаётся ровно на своём месте и просто гаснет.
      // Раньше здесь снимался класс fx-host, а он даёт position:relative —
      // абсолютный холст мгновенно терял ориентир, прилипал к другому предку
      // и уезжал в сторону, и только потом растворялся.
      if (!host) {
        this.canvas.style.opacity = '0';
        return;
      }

      // Вернулись на ту же кнопку, пока холст ещё гас — просто проявляем обратно
      if (this.host === host) {
        this.canvas.style.opacity = '1';
        return;
      }

      // Переезд на другую кнопку: делаем это, пока холст прозрачный,
      // поэтому рывка не видно
      if (this.host) this.host.classList.remove('fx-host');
      this.host = host;
      host.classList.add('fx-host');
      if (this.canvas.parentNode !== host) host.appendChild(this.canvas);

      const r = host.getBoundingClientRect();
      this.w = Math.max(1, Math.round(r.width));
      this.h = Math.max(1, Math.round(r.height));
      this.canvas.width = Math.round(this.w * this.dpr);
      this.canvas.height = Math.round(this.h * this.dpr);
      this.canvas.style.width = this.w + 'px';
      this.canvas.style.height = this.h + 'px';
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      this.kind = palette().grass ? 'grass' : 'nebula';
      this.seed();
      this.canvas.style.opacity = '1';
    }

    /**
     * Травинки и размер рисунка под текущий показ.
     *
     * Размер случайный на каждое появление: на двух кнопках рядом луг и небула
     * не должны выглядеть одинаково. Часы при этом НЕ сбрасываются — анимация
     * идёт непрерывно, наведение только показывает её.
     */
    seed() {
      const v = this.variant = {
        density: 7 + Math.random() * 7,       // пикселей на травинку
        minH: 0.30 + Math.random() * 0.16,    // самая низкая травинка
        spanH: 0.40 + Math.random() * 0.30,   // разброс высот
        wind: 0.20 + Math.random() * 0.24,    // сила ветра
        radius: 0.26 + Math.random() * 0.44,  // базовый радиус облака небулы
        speed: 0.55 + Math.random() * 1.00,   // скорость дрейфа
        spread: 0.22 + Math.random() * 0.24,  // размах облака по кнопке
        drift: Math.random() * Math.PI * 2,
        stars: 8 + Math.floor(Math.random() * 16)
      };

      this.blades = [];
      if (this.kind !== 'grass') return;
      const count = Math.max(14, Math.round(this.w / v.density));
      for (let i = 0; i < count; i++) {
        const tall = Math.random();
        const blade = {
          x: (i + 0.5) * (this.w / count) + (Math.random() - 0.5) * 5,
          h: this.h * (v.minH + tall * v.spanH),
          lean: (Math.random() - 0.5) * 0.32,
          stiff: 0.6 + Math.random() * 0.9,   // одни гнутся сильнее, другие упрямее
          phase: Math.random() * Math.PI * 2,
          angle: 0,
          vel: 0,
          head: tall > 0.45,                   // у высоких на конце колосок
          headTilt: (Math.random() - 0.5) * 0.5
        };
        blade.angle = this.windTarget(blade);
        this.blades.push(blade);
      }
    }

    /** Куда ветер гнёт травинку прямо сейчас. */
    windTarget(b) {
      const gust = Math.sin(this.clock * 1.15 - b.x * 0.035) * 0.5
                 + Math.sin(this.clock * 2.30 - b.x * 0.012 + b.phase) * 0.28;
      const wind = this.variant ? this.variant.wind : 0.32;
      return b.lean + gust * wind * b.stiff;
    }

    frame(dt) {
      // Часы идут всегда, даже когда эффект не показан. Наведение лишь открывает
      // окно в уже идущую анимацию, а не запускает её заново.
      this.clock += dt;
      if (!this.host || !this.kind) return;
      if (this.kind === 'grass') this.drawGrass(dt);
      else this.drawNebula(dt);
    }

    drawGrass(dt) {
      const ctx = this.ctx;
      const pal = palette().grass;
      if (!pal) return;
      ctx.clearRect(0, 0, this.w, this.h);

      const grad = ctx.createLinearGradient(0, this.h * 0.5, 0, this.h);
      grad.addColorStop(0, `rgba(${pal.dark[0]},${pal.dark[1]},${pal.dark[2]},0)`);
      grad.addColorStop(1, `rgba(${pal.dark[0]},${pal.dark[1]},${pal.dark[2]},0.5)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, this.h * 0.5, this.w, this.h * 0.5);

      ctx.lineCap = 'round';
      for (const b of this.blades) {
        // Ветер — две волны с разными периодами, дающие бегущий по лугу порыв.
        // Анимация живёт сама, курсор в ней не участвует.
        const target = this.windTarget(b);

        // Демпфированная пружина: ветер ведёт травинку, упругость возвращает
        b.vel += (target - b.angle) * 30 * dt;
        b.vel *= Math.pow(0.0025, dt);
        b.angle += b.vel * dt;

        const len = b.h;
        const baseY = this.h + 1;
        const tipX = b.x + Math.sin(b.angle) * len;
        const tipY = baseY - Math.cos(b.angle) * len;
        const midX = b.x + Math.sin(b.angle * 0.5) * len * 0.5;
        const midY = baseY - Math.cos(b.angle * 0.5) * len * 0.5;

        const g = ctx.createLinearGradient(b.x, baseY, tipX, tipY);
        g.addColorStop(0, `rgba(${pal.blade[0]},${pal.blade[1]},${pal.blade[2]},0.32)`);
        g.addColorStop(1, `rgba(${pal.tip[0]},${pal.tip[1]},${pal.tip[2]},0.95)`);
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.9;
        ctx.beginPath();
        ctx.moveTo(b.x, baseY);
        ctx.quadraticCurveTo(midX, midY, tipX, tipY);
        ctx.stroke();

        // Колосок: короткий штрих вдоль продолжения травинки
        if (b.head) {
          const a = b.angle + b.headTilt;
          ctx.strokeStyle = `rgba(${pal.tip[0]},${pal.tip[1]},${pal.tip[2]},0.9)`;
          ctx.lineWidth = 2.6;
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(tipX + Math.sin(a) * 7, tipY - Math.cos(a) * 7);
          ctx.stroke();
        }
      }
    }

    drawNebula(dt) {
      const ctx = this.ctx;
      const cols = palette().nebula;
      if (!cols) return;
      // Размер рисунка задан в seed() и свой у каждого показа
      const v = this.variant || { radius: 0.42, speed: 1, spread: 0.34, drift: 0, stars: 14 };
      const base = Math.min(this.w, this.h);

      // След от предыдущего кадра не чистим полностью — облако живёт дольше кадра
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.10)';
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalCompositeOperation = 'lighter';

      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        const s = v.speed * (1 + i * 0.18);   // облака плывут с разной скоростью
        const px = this.w * (0.5 + v.spread * Math.sin(this.clock * 0.19 * s + v.drift + i * 1.7));
        const py = this.h * (0.5 + v.spread * Math.cos(this.clock * 0.15 * s + v.drift + i * 2.3));
        const r = base * (v.radius + 0.10 * Math.sin(this.clock * 0.30 * s + i));
        const g = ctx.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},0.30)`);
        g.addColorStop(0.55, `rgba(${c[0]},${c[1]},${c[2]},0.10)`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Мелкие звёзды поверх облака; их число тоже случайно на каждый показ
      for (let i = 0; i < v.stars; i++) {
        const sx = (i * 97.13 + v.drift * 41) % this.w;
        const sy = (i * 53.71 + v.drift * 23) % this.h;
        const tw = 0.45 + 0.55 * Math.abs(Math.sin(this.clock * (0.9 + i * 0.13) + i));
        ctx.fillStyle = `rgba(235,228,255,${0.5 * tw})`;
        ctx.fillRect(sx, sy, 1.4, 1.4);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // ── Запуск ────────────────────────────────────────────────────────────────

  const FX_SELECTOR = [
    '.nav-btn', '.title-btn', '.mode-btn', '.ghost-btn', '.mini-btn', '.launch-btn',
    '.chip', '.version-item', '.text-link', '.account-row', '.account-remove',
    '.account-close', '.loader-toggle', '.mod-card', '.setting-row', '.sp-btn-open',
    '.sp-btn-cancel', '.close-btn'
  ].join(',');

  function start() {
    if (reduced) return;

    const waveCanvas = document.getElementById('fxWave');
    const hoverCanvas = document.getElementById('fxHover');
    if (!waveCanvas || !hoverCanvas) return;

    const wave = new WaveField(waveCanvas);
    const hover = new HoverFx(hoverCanvas);

    let obstaclesDirty = true;
    const markDirty = () => { obstaclesDirty = true; };
    window.addEventListener('resize', () => { wave.resize(); markDirty(); hover.attach(null); });

    // Маску среды пересобираем по событию, а не по таймеру: buildObstacles
    // дёргает getComputedStyle на каждом элементе, а это принудительный пересчёт
    // стилей. Раз в 400 мс на ровном месте это лишняя работа каждый раз.
    function markObstaclesChanged() { obstaclesDirty = true; }

    // Толчок по любому нажатию
    document.addEventListener('pointerdown', (e) => {
      wave.pulse(e.clientX, e.clientY, 1);
    }, true);

    // Наведение только решает, показывать эффект или нет. Сама анимация
    // крутится от своего таймера и от курсора не зависит.
    let currentHost = null;
    document.addEventListener('pointerover', (e) => {
      const host = e.target.closest ? e.target.closest(FX_SELECTOR) : null;
      if (!host || host.disabled) {
        if (currentHost) { currentHost = null; hover.attach(null); }
        return;
      }
      if (host === currentHost) return;
      currentHost = host;
      hover.attach(host);
    }, true);
    document.addEventListener('pointerout', (e) => {
      if (!currentHost) return;
      const to = e.relatedTarget;
      if (to && currentHost.contains(to)) return;
      currentHost = null;
      hover.attach(null);
    }, true);

    let last = performance.now();
    let pending = 0;
    let paused = false;
    let waveWasActive = false;
    // На слабой машине считаем 30 раз в секунду вместо 60: нагрузка вдвое меньше.
    // Время накапливаем, иначе анимация просто замедлилась бы вдвое.
    const MIN_STEP = LOW ? 1 / 30 : 0;

    function loop(now) {
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (paused) return;

      pending += dt;
      if (MIN_STEP && pending < MIN_STEP) return;
      const step = pending;
      pending = 0;

      if (obstaclesDirty) { wave.buildObstacles(); obstaclesDirty = false; }

      // Поле считаем, только пока в нём есть энергия, — в покое цикл не жжёт кадры
      if (wave.active) {
        wave.step();
        wave.render();
        waveWasActive = true;
      } else if (waveWasActive) {
        wave.clear();
        waveWasActive = false;
      }

      hover.frame(step);
    }
    requestAnimationFrame(loop);

    return {
      /** Свёрнутое окно: не считаем вовсе и не копим время паузы. */
      setPaused(value) {
        paused = !!value;
        pending = 0;
        last = performance.now();
      },
      /** Интерфейс перерисовался — пересобрать маску среды. */
      obstaclesChanged: markObstaclesChanged
    };
  }

  // Управление циклом доступно снаружи до его запуска: приложение зовёт
  // setPaused при сворачивании окна и obstaclesChanged после перерисовки.
  let controls = null;

  // Классы отдаём наружу: на них построены отдельные страницы-тесты,
  // где эффекты видно в чистом виде, без лаунчера.
  return {
    start() { controls = start(); return controls; },
    palette,
    WaveField,
    HoverFx,
    setPaused(value) { if (controls) controls.setPaused(value); },
    obstaclesChanged() { if (controls) controls.obstaclesChanged(); }
  };
})();

// В лаунчере запускаемся сами; тестовые страницы создают эффекты вручную
// и поднимают свой флаг, чтобы не получить вторую копию.
if (!window.FX_TEST_MANUAL) {
  window.addEventListener('DOMContentLoaded', () => FX.start());
}
