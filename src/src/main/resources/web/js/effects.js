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
    return document.body.classList.contains('theme-vanilla') ? PALETTES.vanilla : PALETTES.pulse;
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
      this.obstacles = [];
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
      // Список элементов с их серединой в клетках: по нему потом считаем
      // деформацию кнопок. Пиксельные прямоугольники здесь не нужны —
      // getBoundingClientRect на каждом кадре стоил бы раскладки.
      this.obstacles = [];
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
        this.obstacles.push({ el, ci: (x0 + x1) >> 1, cj: (y0 + y1) >> 1, lastMag: 0 });
      }
    }

    /* Сила волны в клетке: направление и величина. Нормируем на WAVE_REF —
       градиент, который считаем «полной силой», иначе константы пришлось бы
       подбирать под масштаб поля, а он меняется вместе с CELL. */
    forceAt(ci, cj) {
      const { cols, rows, cur } = this;
      if (ci < 1 || cj < 1 || ci >= cols - 1 || cj >= rows - 1) {
        return { x: 0, y: 0, sx: 0, sy: 0, mag: 0 };
      }
      const i = cj * cols + ci;
      const gx = cur[i + 1] - cur[i - 1];
      const gy = cur[i + cols] - cur[i - cols];
      const mag = Math.hypot(gx, gy);
      if (mag < 0.001) return { x: 0, y: 0, sx: 0, sy: 0, mag: 0 };

      const n = Math.min(1, mag / WAVE_REF);
      const nx = gx / mag;
      const ny = gy / mag;
      return {
        x: nx * n * WAVE_PUSH_MAX,
        y: ny * n * WAVE_PUSH_MAX,
        // Вдоль хода волны кнопка растягивается, поперёк — нет
        sx: nx * n * WAVE_STRETCH_MAX,
        sy: ny * n * WAVE_STRETCH_MAX,
        mag
      };
    }

    /* Только очистка холста, без сброса поля: нужна кадрам, где волны уже нет,
       а щупальца ещё рисуются. */
    clearCanvas() {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
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
      // Насколько приглушить рисунок. Эффект лежит между фоном кнопки и её
      // текстом, и в полную яркость надпись на нём не читается.
      this.dimAlpha = 0.46;
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
        stars: []
      };

      // Звёзды небулы. Раньше рисовались квадратиком 1.4 px и читались точками.
      // Теперь у каждой своё ядро, ореол, размер и фаза мерцания — задаём это
      // здесь, чтобы рисунок был стабильным, а не считался из индекса каждый кадр.
      const starCount = 10 + Math.floor(Math.random() * 14);
      for (let i = 0; i < starCount; i++) {
        v.stars.push({
          x: Math.random() * this.w,
          y: Math.random() * this.h,
          r: 0.6 + Math.random() * 1.6,       // размер ядра
          phase: Math.random() * Math.PI * 2,
          speed: 0.6 + Math.random() * 1.5,   // у каждой своя скорость мерцания
          bright: Math.random() > 0.55        // у ярких будут лучики
        });
      }

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
      this.dim();
    }

    /**
     * Приглушает рисунок. Эффект лежит между фоном кнопки и её текстом, поэтому
     * в полную яркость надпись на нём пропадает. source-atop затемняет ровно то,
     * что уже нарисовано, и не трогает прозрачный фон вокруг.
     */
    dim() {
      if (!this.dimAlpha) return;
      const ctx = this.ctx;
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = `rgba(9,9,14,${this.dimAlpha})`;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalCompositeOperation = 'source-over';
    }

    drawGrass(dt) {
      const ctx = this.ctx;
      const pal = palette().grass;
      if (!pal) return;
      ctx.clearRect(0, 0, this.w, this.h);

      const grad = ctx.createLinearGradient(0, this.h * 0.5, 0, this.h);
      grad.addColorStop(0, `rgba(${pal.dark[0]},${pal.dark[1]},${pal.dark[2]},0)`);
      grad.addColorStop(1, `rgba(${pal.dark[0]},${pal.dark[1]},${pal.dark[2]},0.38)`);
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
        g.addColorStop(0, `rgba(${pal.blade[0]},${pal.blade[1]},${pal.blade[2]},0.26)`);
        g.addColorStop(1, `rgba(${pal.tip[0]},${pal.tip[1]},${pal.tip[2]},0.85)`);
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
      const v = this.variant || { radius: 0.42, speed: 1, spread: 0.34, drift: 0, stars: [] };
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
        g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},0.26)`);
        g.addColorStop(0.55, `rgba(${c[0]},${c[1]},${c[2]},0.09)`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Мелкие звёзды поверх облака. У каждой ядро с ореолом, мерцание со своей
      // фазой и скоростью, а у ярких — лучики, как у настоящих звёзд.
      for (const st of v.stars) {
        const tw = 0.35 + 0.65 * Math.abs(Math.sin(this.clock * st.speed + st.phase));
        const glow = st.r * 4.5;

        const g = ctx.createRadialGradient(st.x, st.y, 0, st.x, st.y, glow);
        g.addColorStop(0, `rgba(255,255,255,${0.85 * tw})`);
        g.addColorStop(0.28, `rgba(214,200,255,${0.34 * tw})`);
        g.addColorStop(1, 'rgba(120,100,200,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(st.x, st.y, glow, 0, Math.PI * 2);
        ctx.fill();

        if (st.bright) {
          const arm = st.r * 3.4 * tw;
          ctx.strokeStyle = `rgba(255,255,255,${0.5 * tw})`;
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          ctx.moveTo(st.x - arm, st.y); ctx.lineTo(st.x + arm, st.y);
          ctx.moveTo(st.x, st.y - arm); ctx.lineTo(st.x, st.y + arm);
          ctx.stroke();
        }
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

  // ── Физика кнопок ─────────────────────────────────────────────────────────
  //
  // Кнопка ведёт себя как лёгкая пластина на пружине: под курсором слегка
  // подаётся к нему, а когда курсор ушёл — возвращается с перелётом. Плюс
  // проходящая волна толкает её и растягивает по направлению движения.

  const SPRING_STIFF = 120;    // жёсткость пружины
  const SPRING_DAMP = 12;      // затухание; 12/(2*sqrt(120)) ≈ 0.55 — перелёт есть
  const LEAN = 0.08;           // какую долю смещения курсора кнопка отыгрывает
  const LEAN_MAX = 3;          // дальше не тянемся, иначе кнопка уезжает
  const HOVER_STRETCH = 0.03;  // на сколько кнопка вытягивается к курсору
  const WAVE_PUSH_MAX = 2.5;     // на сколько пикселей волна сдвигает кнопку
  const WAVE_STRETCH_MAX = 0.03; // и на сколько растягивает вдоль своего хода
  const WAVE_REF = 12;           // градиент, считающийся «полной силой»
  // Ниже этого волна считается ушедшей: смещение вышло бы 0.06 px, а растяжение
  // 0.1% — глазом всё равно не видно, а стиль на кнопке висел бы.
  const WAVE_QUIET = 0.3;
  const REST_EPS = 0.05;       // смещение ниже этого (в пикселях) не видно
  const SCALE_EPS = 0.0005;    // и растяжение ниже этого — тоже

  class ButtonRig {
    constructor() {
      this.items = new Map();
      this.pointer = { x: 0, y: 0 };
    }

    /* Геометрию кнопки берём один раз при первом обращении. Перемерять её
       каждый кадр нельзя: getBoundingClientRect в цикле — это принудительная
       раскладка на каждом кадре, ровно то, от чего мы уходили в buildObstacles. */
    state(el) {
      let s = this.items.get(el);
      if (!s) {
        const r = el.getBoundingClientRect();
        s = {
          el,
          cx: r.left + r.width / 2,
          cy: r.top + r.height / 2,
          ox: 0, oy: 0, vx: 0, vy: 0,
          wx: 0, wy: 0, sx: 1, sy: 1,
          hover: false, written: false
        };
        this.items.set(el, s);
      }
      return s;
    }

    setHover(el) {
      if (this.hovered && this.hovered !== el) {
        const prev = this.items.get(this.hovered);
        if (prev) prev.hover = false;
      }
      this.hovered = el;
      if (el) this.state(el).hover = true;
    }

    /* Толчок и растяжение от волны. Значения приходят уже посчитанными по
       сетке — здесь только запись в стили. */
    setWave(el, wx, wy, sx, sy) {
      const s = this.state(el);
      s.wx = wx; s.wy = wy; s.sx = sx; s.sy = sy;
    }

    frame(dt, wave) {
      if (wave && wave.obstacles) {
        // Волна активна — раздаём деформацию всем, до кого она дошла.
        // Пропускаем те, где сила была и осталась нулевой: писать стиль
        // элементу, который волна не задела, — лишний пересчёт на каждом кадре.
        for (const o of wave.obstacles) {
          if (!o.el.isConnected) continue;
          const f = wave.forceAt(o.ci, o.cj);
          const was = o.lastMag || 0;
          o.lastMag = f.mag;

          if (f.mag < WAVE_QUIET) {
            // Фронт ушёл — возвращаем кнопку в ноль. Без этого на ней остаётся
            // последнее, пусть и микроскопическое, смещение: поле затухает
            // геометрически и формально остаётся «активным» десятки секунд.
            if (was >= WAVE_QUIET) this.setWave(o.el, 0, 0, 1, 1);
            continue;
          }
          this.setWave(o.el, f.x, f.y, 1 + f.sx, 1 + f.sy);
        }
      } else {
        /* Волна погасла, и цикл выше в этом кадре не выполнялся. Обнуляем её
           вклад у всех, кого она держала: иначе последнее смещение остаётся
           на кнопке навсегда, и она никогда не признаётся успокоившейся. */
        for (const s of this.items.values()) {
          if (s.wx || s.wy || s.sx !== 1 || s.sy !== 1) {
            s.wx = 0; s.wy = 0; s.sx = 1; s.sy = 1;
          }
        }
      }

      const px = this.pointer.x;
      const py = this.pointer.y;

      for (const [el, s] of this.items) {
        if (!el.isConnected) { this.items.delete(el); continue; }

        // Цель: под курсором — податься к нему, иначе — вернуться на место
        let tx = 0, ty = 0;
        if (s.hover) {
          tx = Math.max(-LEAN_MAX, Math.min(LEAN_MAX, (px - s.cx) * LEAN));
          ty = Math.max(-LEAN_MAX, Math.min(LEAN_MAX, (py - s.cy) * LEAN));
        }

        /* Пружина. Перелёт получается сам: затухание подобрано так, чтобы
           колебание было недодемпфированным и кнопка чуть проскакивала цель.

           Шаг ограничиваем, а затухание берём экспонентой — иначе на просадке
           кадров пружина раскачивается. При dt = 0.09 множитель (1 − D·dt)
           становится отрицательным: скорость каждый шаг меняет знак и вместо
           затухания получаются вечные колебания. На 60 fps это незаметно,
           на слабой машине кнопка дёргалась бы бесконечно. */
        const h = Math.min(dt, 1 / 30);
        const decay = Math.exp(-SPRING_DAMP * h);
        s.vx = (s.vx + (tx - s.ox) * SPRING_STIFF * h) * decay;
        s.vy = (s.vy + (ty - s.oy) * SPRING_STIFF * h) * decay;
        s.ox += s.vx * h;
        s.oy += s.vy * h;

        /* Растяжение кнопки к курсору. Считаем его от ТЕКУЩЕГО смещения
           пружины, а не от положения курсора напрямую: пружина уже сглажена,
           поэтому кнопка вытягивается плавно и так же плавно отпускает —
           с тем же отскоком, без отдельной анимации. */
        const lean = Math.hypot(s.ox, s.oy);
        const pull = Math.min(1, lean / LEAN_MAX) * HOVER_STRETCH;
        const pullX = lean > 0.01 ? (s.ox / lean) * pull : 0;
        const pullY = lean > 0.01 ? (s.oy / lean) * pull : 0;
        const sx = s.sx * (1 + pullX);
        const sy = s.sy * (1 + pullY);

        /* Покой считаем по СУММЕ смещений пружины и волны: если смотреть на них
           по отдельности, микроскопический остаток волны не даёт кнопке
           успокоиться.

           Наведение в условие НЕ входит. Если курсор стоит по центру кнопки,
           цель у пружины нулевая и кнопка уже на месте — писать ей стили каждый
           кадр было бы впустую. В списке она при этом остаётся: признак
           наведения живёт отдельно, в s.hover. */
        const settled = Math.abs(s.ox + s.wx) < REST_EPS && Math.abs(s.oy + s.wy) < REST_EPS
          && Math.abs(s.vx) < REST_EPS && Math.abs(s.vy) < REST_EPS
          && Math.abs(sx - 1) < SCALE_EPS && Math.abs(sy - 1) < SCALE_EPS;

        if (settled) {
          // В покое стили снимаем совсем: иначе инлайновые translate/scale
          // висят на кнопке и мешают её собственным CSS-переходам
          if (s.written) {
            el.style.translate = '';
            el.style.scale = '';
            s.written = false;
          }
          if (!s.hover) this.items.delete(el);
          continue;
        }

        /* Пишем в независимые свойства translate и scale, а НЕ в transform.
           У кнопок уже есть transform в CSS (:hover сдвигает на пару
           пикселей), и инлайновый transform перебил бы его — при наведении
           собственный сдвиг кнопки пропадал бы. Эти свойства складываются
           с transform, а не заменяют его. */
        el.style.translate = `${(s.ox + s.wx).toFixed(2)}px ${(s.oy + s.wy).toFixed(2)}px`;
        el.style.scale = `${sx.toFixed(4)} ${sy.toFixed(4)}`;
        s.written = true;

        // Волна затухла, кнопка стоит, курсора на ней нет — забываем её
        if (!s.hover && Math.abs(s.wx) < REST_EPS && Math.abs(s.wy) < REST_EPS) {
          s.wx = 0; s.wy = 0; s.sx = 1; s.sy = 1;
        }
      }
    }
  }

  // ── Растяжение кромки кнопки ──────────────────────────────────────────────
  //
  // Кромка кнопки сама тянется к курсору: силуэт деформируется, и горб плавно
  // обходит кнопку по кругу, а не прыгает по четырём сторонам.
  //
  // Рисовать это поверх кнопки нельзя — получится заплатка другого цвета.
  // Поэтому здесь отдельный слой ВНУТРИ кнопки, унаследовавший её фон, с
  // вырезом по её же силуэту: слой виден только за пределами кнопки, и горб
  // читается её собственным продолжением. Фон наследуется, поэтому годится и
  // градиент; размер и положение фона выставляются вручную, иначе градиент
  // растянулся бы на увеличенный слой и не совпал с кнопкой.

  /* Числа перенесены из шейдера wild (assets/wild/shaders/mainmenu/menu_button.frag).
     Там кромка — это SDF скруглённого прямоугольника, из которого вычитается
     стоячая волна по углу:

       ferro = edgeBand * uMagnet * (1.6 + attract * 7.0)
             * (0.34 + ferroWave * 0.46 + ferroFine * 0.20)
             * (0.38 + mouseSide * 0.92);

     ferroWave — 18 крупных лепестков, ferroFine — 31 мелкий, оба бегут во
     времени. Это и есть «шипы»: кромка рябит феррожидкостью. mouseSide
     поднимает их втрое с той стороны, где курсор, а attract добавляет всплеск
     у самой мыши. Множитель 0.38 при этом не ноль — рябь идёт по всему
     периметру, а не только у курсора. */
  const FERRO_BASE = 1.6;        // базовая высота ряби
  const FERRO_ATTRACT = 7.0;     // добавка у курсора
  const FERRO_COARSE_HZ = 18.0;  // крупных лепестков по периметру
  const FERRO_FINE_HZ = 31.0;    // мелких
  const FERRO_COARSE_SPEED = 3.8;
  const FERRO_FINE_SPEED = 5.2;
  const FERRO_REST = 0.38;       // рябь вдали от курсора: доля от полной
  const FERRO_SIDE = 0.92;       // добавка за то, что точка смотрит на курсор
  const ATTRACT_FALLOFF = 2.8;   // крутизна всплеска у курсора
  /* Общая длина шипов. В шейдере числа заданы для кнопки одного размера и
     одного масштаба интерфейса; здесь кнопки мельче, и те же значения читаются
     как лёгкая рябь. Множитель вытягивает лепестки, не меняя их рисунок:
     пропорции между крупными и мелкими, всплеск у курсора и наклон к нему
     остаются ровно такими, как в оригинале. */
  const FERRO_LENGTH = 2.4;

  const BULGE_MARGIN = 52;   // запас слоя вокруг кнопки: шипы плюс сглаживание
  // Тридцать один лепесток на периметр требует минимум 62 точки, иначе волна
  // просто не разрешается и рябь превращается в случайный шум
  const BULGE_POINTS = 180;

  class EdgeBulge {
    constructor() {
      this.el = document.createElement('div');
      this.el.className = 'fx-bulge';
      this.host = null;
      this.rect = null;
      this.pts = [];
      this.dirX = 0;
      this.dirY = 0;
      this.pointer = { x: 0, y: 0 };
      this.strength = 0;     // 0..1 — рябь нарастает и спадает, а не щёлкает
      this.clock = 0;        // часы ряби: она должна бежать, а не стоять
      this.rad = 0;
    }

    attach(host) {
      if (this.host && this.host !== host) this.el.style.display = 'none';
      this.host = host;
      if (!host) return;

      if (this.el.parentNode !== host) host.appendChild(this.el);
      this.rect = host.getBoundingClientRect();

      const cs = getComputedStyle(host);
      this.rad = Math.max(0, Math.min(
        parseFloat(cs.borderTopLeftRadius) || 0,
        this.rect.width / 2, this.rect.height / 2));
      this.pts = this.perimeter();

      const m = BULGE_MARGIN;
      this.el.style.display = 'block';
      this.el.style.left = -m + 'px';
      this.el.style.top = -m + 'px';
      this.el.style.width = (this.rect.width + m * 2) + 'px';
      this.el.style.height = (this.rect.height + m * 2) + 'px';
      /* Тот же фон, что у кнопки, растянутый на весь слой.
         Уложить его ровно по прямоугольнику кнопки нельзя: тогда за её
         пределами фон окажется пустым и горб будет нечем закрасить — слой
         просто не видно. Растяжение выходит около двадцати процентов, и на
         кромке кнопки градиент расходится с её собственным меньше чем на шаг
         цвета. На сплошных кнопках расхождения нет вовсе. */
      this.el.style.background = 'inherit';
      this.el.style.backgroundSize = '100% 100%';
      this.el.style.backgroundPosition = '0 0';
      this.el.style.backgroundOrigin = 'border-box';
      this.el.style.backgroundRepeat = 'no-repeat';

      this.strength = 0;
    }

    /* Точки периметра скруглённого прямоугольника по часовой стрелке,
       с внешней нормалью в каждой. Нужны и для внешнего контура, и для
       выреза: вырез — те же точки в обратном порядке. */
    perimeter() {
      const m = BULGE_MARGIN;
      const w = this.rect.width;
      const h = this.rect.height;
      const r = Math.min(this.rad, w / 2, h / 2);

      // Восемь кусков: четыре прямых и четыре дуги. Длины нужны, чтобы точки
      // легли равномерно, а не сгустились на углах.
      const segs = [];
      const add = (len, fx) => segs.push({ len: Math.max(len, 0.001), fx });

      add(w - 2 * r, (t, o) => { o.x = m + r + t * (w - 2 * r); o.y = m; o.nx = 0; o.ny = -1; });
      add(Math.PI * r / 2, (t, o) => {
        const a = -Math.PI / 2 + t * Math.PI / 2;
        o.x = m + w - r + Math.cos(a) * r; o.y = m + r + Math.sin(a) * r;
        o.nx = Math.cos(a); o.ny = Math.sin(a);
      });
      add(h - 2 * r, (t, o) => { o.x = m + w; o.y = m + r + t * (h - 2 * r); o.nx = 1; o.ny = 0; });
      add(Math.PI * r / 2, (t, o) => {
        const a = t * Math.PI / 2;
        o.x = m + w - r + Math.cos(a) * r; o.y = m + h - r + Math.sin(a) * r;
        o.nx = Math.cos(a); o.ny = Math.sin(a);
      });
      add(w - 2 * r, (t, o) => { o.x = m + w - r - t * (w - 2 * r); o.y = m + h; o.nx = 0; o.ny = 1; });
      add(Math.PI * r / 2, (t, o) => {
        const a = Math.PI / 2 + t * Math.PI / 2;
        o.x = m + r + Math.cos(a) * r; o.y = m + h - r + Math.sin(a) * r;
        o.nx = Math.cos(a); o.ny = Math.sin(a);
      });
      add(h - 2 * r, (t, o) => { o.x = m; o.y = m + h - r - t * (h - 2 * r); o.nx = -1; o.ny = 0; });
      add(Math.PI * r / 2, (t, o) => {
        const a = Math.PI + t * Math.PI / 2;
        o.x = m + r + Math.cos(a) * r; o.y = m + r + Math.sin(a) * r;
        o.nx = Math.cos(a); o.ny = Math.sin(a);
      });

      const total = segs.reduce((a, s) => a + s.len, 0) || 1;
      const out = [];
      for (let i = 0; i < BULGE_POINTS; i++) {
        let d = (i / BULGE_POINTS) * total;
        let seg = segs[0];
        for (const s of segs) {
          if (d <= s.len) { seg = s; break; }
          d -= s.len;
        }
        const o = { x: 0, y: 0, nx: 0, ny: 0 };
        seg.fx(Math.min(1, d / seg.len), o);
        out.push(o);
      }
      return out;
    }

    /* Контур: внешний — периметр, выдавленный наружу на рябь; следом тот же
       периметр в обратном порядке. Вместе они дают кольцо по правилу
       ненулевого обхода: слой красит только то, что ВНЕ кнопки, поэтому фон
       кнопки не задваивается и полупрозрачные кнопки не мутнеют.

       Высота ряби считается ровно по формуле из шейдера: точка периметра
       смотрит на курсор тем сильнее, чем ближе её нормаль к направлению на
       мышь, и тем выше там лепестки. */
    path() {
      const pts = this.pts;
      const n = pts.length;
      const dx = this.dirX;
      const dy = this.dirY;
      const t = this.clock;

      // Всплеск у курсора считается в единицах высоты кнопки — так же, как в
      // шейдере, где расстояние делится на size.y. Иначе на широкой кнопке
      // всплеск растянулся бы на всю её длину.
      const h = Math.max(1, this.rect.height);
      const mpx = this.pointer.x;
      const mpy = this.pointer.y;
      const r0 = this.rect.left;
      const t0 = this.rect.top;

      /* ferro в шейдере — уже пиксели, поэтому множить его на предел нельзя:
         получились бы шипы втрое выше задуманных. Остаётся только соразмерить
         кнопке: числа шейдера рассчитаны на кнопку около пятидесяти шести
         пикселей высотой, на меньшей рябь должна быть тише. */
      const sizeScale = Math.min(1, Math.min(this.rect.width, this.rect.height) / 56);
      const gain = this.strength * sizeScale * FERRO_LENGTH;

      let d = '';
      for (let i = 0; i < n; i++) {
        const p = pts[i];

        // Угол точки по нормали: по нему бегут лепестки
        const ang = Math.atan2(p.ny, p.nx);
        const coarse = 0.5 + 0.5 * Math.sin(
          ang * FERRO_COARSE_HZ + t * FERRO_COARSE_SPEED
          + Math.sin(ang * 5 - t * 1.1));
        const fine = 0.5 + 0.5 * Math.sin(ang * FERRO_FINE_HZ - t * FERRO_FINE_SPEED);

        // Всплеск у самой мыши: гауссово пятно радиусом примерно в высоту кнопки
        const ex = (p.x + r0 - mpx) / h;
        const ey = (p.y + t0 - mpy) / h;
        const attract = Math.exp(-(ex * ex + ey * ey) * ATTRACT_FALLOFF);

        // Насколько точка смотрит на курсор
        const side = Math.max(0, p.nx * dx + p.ny * dy);

        const ferro = (FERRO_BASE + attract * FERRO_ATTRACT)
          * (0.34 + coarse * 0.46 + fine * 0.20)
          * (FERRO_REST + side * FERRO_SIDE);

        const r = gain * ferro;
        d += (i ? 'L' : 'M') + (p.x + p.nx * r).toFixed(2) + ' ' + (p.y + p.ny * r).toFixed(2);
      }
      d += 'Z';
      for (let i = n - 1; i >= 0; i--) {
        d += 'L' + pts[i].x.toFixed(2) + ' ' + pts[i].y.toFixed(2);
      }
      return 'path("' + d + 'Z")';
    }

    frame(dt, hovered) {
      if (!this.host || !this.host.isConnected) { this.strength = 0; return; }

      // Нарастание и спад: горб появляется и уходит плавно, а не щелчком
      const target = hovered ? 1 : 0;
      this.strength += (target - this.strength) * Math.min(1, dt * 9);
      if (this.strength < 0.004 && !hovered) {
        this.el.style.display = 'none';
        this.strength = 0;
        return;
      }
      this.el.style.display = 'block';
      // Часы ряби: пока кнопка наведена, лепестки бегут
      this.clock += dt;

      const r = this.rect;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = this.pointer.x - cx;
      const dy = this.pointer.y - cy;
      const dist = Math.hypot(dx, dy);
      // Курсор ровно в центре — направление не определено, оставляем прежнее:
      // иначе горб дёргался бы от любого дрожания мыши
      if (dist > 1) {
        // Поворот сглаживаем: горб должен переезжать по кромке, а не прыгать
        const k = Math.min(1, dt * 12);
        this.dirX += (dx / dist - this.dirX) * k;
        this.dirY += (dy / dist - this.dirY) * k;
        const m = Math.hypot(this.dirX, this.dirY) || 1;
        this.dirX /= m;
        this.dirY /= m;
      }

      this.el.style.clipPath = this.path();
    }
  }

  function start() {
    if (reduced) return;

    const waveCanvas = document.getElementById('fxWave');
    const hoverCanvas = document.getElementById('fxHover');
    if (!waveCanvas || !hoverCanvas) return;

    const wave = new WaveField(waveCanvas);
    const hover = new HoverFx(hoverCanvas);
    const rig = new ButtonRig();
    const bulge = new EdgeBulge();

    // Полоска жизни в сайдбаре. Держим два эффекта на разных холстах и
    // показываем ровно один: диораму в Vanilla, небулу в режиме чита.
    const stripHost = document.getElementById('sidebarFx');
    let stripFx = null;
    let diorama = null;
    let dioramaCanvas = null;
    let skinNick = null;   // ник мог прийти раньше, чем диорама догрузилась
    let skinBust = 0;      // метка версии скина после сброса кэша на сервере

    let stripRetries = 0;

    function applyStripMode() {
      if (!stripHost) return;
      const vanilla = document.body.classList.contains('theme-vanilla');
      if (stripFx) stripFx.canvas.style.display = vanilla ? 'none' : 'block';
      if (!dioramaCanvas) return;

      dioramaCanvas.style.display = vanilla ? 'block' : 'none';
      if (!vanilla) return;

      const r = stripHost.getBoundingClientRect();
      // Полоска может ещё не получить размеров — тогда повторим на следующем тике,
      // иначе сцена сгенерируется в ноль пикселей и останется пустой
      if ((r.width < 4 || r.height < 4) && stripRetries < 40) {
        stripRetries++;
        setTimeout(applyStripMode, 120);
        return;
      }
      if (r.width < 4 || r.height < 4) return;

      stripRetries = 0;
      diorama.generate(Math.round(r.width), Math.round(r.height));
      diorama.frame(0);   // сразу показать кадр, не дожидаясь следующего тика
    }

    if (stripHost) {
      stripFx = new HoverFx(document.createElement('canvas'));
      stripFx.dimAlpha = 0.16;   // над полоской текста нет, приглушаем меньше
      stripFx.attach(stripHost);

      dioramaCanvas = document.createElement('canvas');
      dioramaCanvas.style.position = 'absolute';
      dioramaCanvas.style.inset = '0';
      dioramaCanvas.style.zIndex = '-1';
      dioramaCanvas.style.pointerEvents = 'none';
      dioramaCanvas.style.display = 'none';
      stripHost.appendChild(dioramaCanvas);

      diorama = new Scene.Diorama(dioramaCanvas);
      diorama.load().then((ok) => {
        if (ok) applyStripMode();
        // Скин, о котором попросили до загрузки текстур, надеваем здесь
        if (skinNick) diorama.setPlayerSkin(skinNick, skinBust);
      });
    }

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

    // Позиция курсора нужна пружине кнопки и щупальцам. Слушатель пассивный:
    // мы только читаем координаты и ничего не отменяем.
    document.addEventListener('pointermove', (e) => {
      rig.pointer.x = e.clientX;
      rig.pointer.y = e.clientY;
      bulge.pointer.x = e.clientX;
      bulge.pointer.y = e.clientY;
    }, { passive: true });

    // Наведение только решает, показывать эффект или нет. Сама анимация
    // крутится от своего таймера и от курсора не зависит.
    let currentHost = null;
    document.addEventListener('pointerover', (e) => {
      const host = e.target.closest ? e.target.closest(FX_SELECTOR) : null;
      if (!host || host.disabled) {
        if (currentHost) { currentHost = null; hover.attach(null); bulge.attach(null); rig.setHover(null); }
        return;
      }
      if (host === currentHost) return;
      currentHost = host;
      hover.attach(host);
      bulge.attach(host);
      rig.setHover(host);
    }, true);
    document.addEventListener('pointerout', (e) => {
      if (!currentHost) return;
      const to = e.relatedTarget;
      if (to && currentHost.contains(to)) return;
      currentHost = null;
      hover.attach(null);
      bulge.attach(null);
      rig.setHover(null);
    }, true);

    let last = performance.now();
    let pending = 0;
    let paused = false;
    let waveWasActive = false;
    // На слабой машине считаем 30 раз в секунду вместо 60: нагрузка вдвое меньше.
    // Время накапливаем, иначе анимация просто замедлилась бы вдвое.
    const MIN_STEP = LOW ? 1 / 30 : 0;

    // ── Бездействие ─────────────────────────────────────────────────────────
    //
    // Игрок отошёл, а окно открыто и на виду: живой фон, круг за курсором и
    // диорама продолжают считаться, хотя смотреть на них некому. Это чистый
    // расход батареи. Через полминуты без мыши и клавиатуры замираем.
    //
    // Возврат ничего не стоит: часы идут от накопленного времени, а не от
    // числа кадров, поэтому движение продолжается с той же фазы, а не
    // прыгает вперёд на всё, что мы пропустили.
    const IDLE_AFTER = 30;
    let idle = 0;
    const wake = () => { idle = 0; };
    for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'focus']) {
      window.addEventListener(ev, wake, { passive: true });
    }

    function loop(now) {
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (paused) return;

      // Замерли — не считаем ни волну, ни пружину, ни диораму. Последний
      // нарисованный кадр остаётся на экране, так что глазу не за что
      // зацепиться: картинка та же, просто неподвижная.
      idle += dt;
      if (idle >= IDLE_AFTER) return;

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

      // Горб кромки живёт на самой кнопке своим слоем, к холсту волны
      // отношения не имеет
      bulge.frame(step, !!currentHost && currentHost === bulge.host);

      // Пружину кнопок считаем всегда: она должна догрузиться до нуля даже
      // после того, как волна погасла
      rig.frame(step, wave.active ? wave : null);

      hover.frame(step);
      // В полоске активен ровно один эффект: диорама или небула
      if (dioramaCanvas && dioramaCanvas.style.display !== 'none') diorama.frame(step);
      else if (stripFx) stripFx.frame(step);
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
      obstaclesChanged: markObstaclesChanged,
      /** Сменился режим — полоска и наведение должны сменить луг на небулу. */
      refreshMode() {
        const kind = palette().grass ? 'grass' : 'nebula';
        if (stripFx) { stripFx.kind = kind; stripFx.seed(); }
        if (hover && hover.host) { hover.kind = kind; hover.seed(); }
        applyStripMode();
      },
      /**
       * Скин и плащ игрока в диораме.
       *
       * Ник запоминаем всегда, а надеваем только когда текстуры уже загружены:
       * приложение зовёт это при старте, а диорама к тому моменту ещё может
       * догружаться — без запоминания скин бы просто потерялся.
       */
      setPlayerSkin(nick, bust) {
        skinNick = nick;
        // Метку помним рядом с ником: скин мог быть сброшен на сервере, и тогда
        // догоняющий вызов ниже обязан идти по адресу с меткой, а не по чистому.
        skinBust = bust || 0;
        if (diorama && diorama.tex) diorama.setPlayerSkin(nick, skinBust);
      }
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
    obstaclesChanged() { if (controls) controls.obstaclesChanged(); },
    refreshMode() { if (controls) controls.refreshMode(); },
    setPlayerSkin(nick, bust) { if (controls) controls.setPlayerSkin(nick, bust); }
  };
})();

// В лаунчере запускаемся сами; тестовые страницы создают эффекты вручную
// и поднимают свой флаг, чтобы не получить вторую копию.
//
// Кладём FX в window явно: `const` на верхнем уровне скрипта создаёт
// лексическую привязку, но НЕ свойство глобального объекта. Без этой строки
// обращения вида window.FX из app.js молча ничего не делают.
window.FX = FX;

if (!window.FX_TEST_MANUAL) {
  window.addEventListener('DOMContentLoaded', () => FX.start());
}
