'use strict';
/*
 * Диорама для полоски в сайдбаре — режим Vanilla.
 *
 * Собирается из настоящих текстур Minecraft, вынутых из клиентского jar:
 * дёрн, земля, дуб, цветы, трава и Стив. Рельеф случайный при каждом показе,
 * высота до пяти блоков. Под дубом сидит игрок и поворачивает голову
 * вслед за курсором.
 *
 * Земля и дерево рисуются один раз в отдельный холст: они статичны, и
 * пересобирать их каждый кадр незачем. Поверх уже идёт живое — качающаяся
 * трава и голова Стива.
 *
 * Размер блока считается от ширины полоски, поэтому диорама сама подгоняется
 * под сайдбар.
 */

const Scene = (() => {
  const BASE = 'assets/scene/';

  const TEX_FILES = {
    grassSide: 'grass_block_side.png',
    dirt: 'dirt.png',
    log: 'oak_log.png',
    leaves: 'oak_leaves.png',
    poppy: 'poppy.png',
    dandelion: 'dandelion.png',
    grass: 'short_grass.png',
    steve: 'steve.png'
  };

  // ── 2.5D-модель игрока ────────────────────────────────────────────────────
  //
  // Стив собран из настоящих коробок модели Minecraft и проецируется на
  // плоскость ортографической камерой с поворотом. Голова — отдельная коробка,
  // которая вращается вокруг своей оси: лицо при этом сужается по косинусу,
  // а сбоку открывается боковая грань. Это и есть правильный поворот —
  // сдвиг окна по атласу (как было раньше) давал просто смазанную текстуру.
  //
  // Координаты в юнитах, 16 юнитов = блок. x — вправо, y — вверх, z — на зрителя.
  const VIEW_YAW = 26 * Math.PI / 180;    // поворот камеры: видно лицо и немного бока
  const VIEW_PITCH = 13 * Math.PI / 180;  // наклон: видно немного сверху

  // Направленное освещение граней, как в Minecraft. Без него куб читается
  // плоским пятном. Верх светлее всего, низ темнее всех.
  const FACE_SHADE = { top: 1.00, front: 0.92, back: 0.90, right: 0.78, left: 0.78, bottom: 0.62 };

  // Пределы поворота головы. Дальше ~45° она выворачивает шею — это выглядит
  // сломанным, поэтому угол мягко ограничен: tanh подходит к пределу
  // асимптотически, без рывка на краю.
  const HEAD_YAW_LIMIT = 46 * Math.PI / 180;
  const HEAD_PITCH_UP = 28 * Math.PI / 180;
  const HEAD_PITCH_DOWN = 26 * Math.PI / 180;

  const FACE_NORMAL = {
    front: [0, 0, 1], back: [0, 0, -1], right: [1, 0, 0],
    left: [-1, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0]
  };

  // ── Скелет сидячей позы ───────────────────────────────────────────────────
  //
  // Ноги и руки из ДВУХ сегментов и сгибаются. Одной прямой палкой поза
  // получалась неправильной: рука длиной 12 юнитов не может лечь на колени,
  // до которых от плеча всего 7,5 — нужен сгиб в локте.
  const HIP_Y = 2;                    // тазобедренный сустав: таз на земле
  const THIGH = 6;                    // бедро
  const SHIN = 6;                     // голень
  const THIGH_ANGLE = Math.asin((SHIN - HIP_Y) / THIGH);   // ступня ровно на земле
  const KNEE_Y = HIP_Y + THIGH * Math.sin(THIGH_ANGLE);
  const KNEE_Z = THIGH * Math.cos(THIGH_ANGLE);

  const SHOULDER_Y = 12;

  // Сидячая поза: таз на земле, ноги согнуты, руки прямыми вдоль тела.
  // Руки намеренно НЕ наклонены вперёд: предплечья попадали ровно в область
  // коленей, и сгиб руки читался как колено, а сами ноги за ним терялись.
  const PLAYER_BODY = [
    { id: 'torso', uv: [16, 16], from: [-4, 0, -2], to: [4, 12, 2] },

    { id: 'armR', uv: [40, 16], from: [4, 0, -2], to: [8, 12, 2], pivot: [6, SHOULDER_Y, 0] },
    { id: 'armL', uv: [32, 48], from: [-8, 0, -2], to: [-4, 12, 2], pivot: [-6, SHOULDER_Y, 0] },

    { id: 'thighR', uv: [0, 16], from: [0, HIP_Y - THIGH, -2], to: [4, HIP_Y, 2],
      pivot: [2, HIP_Y, 0], baseRot: -Math.PI + THIGH_ANGLE },
    { id: 'thighL', uv: [0, 16], from: [-4, HIP_Y - THIGH, -2], to: [0, HIP_Y, 2],
      pivot: [-2, HIP_Y, 0], baseRot: -Math.PI + THIGH_ANGLE },
    // Голени вращаются вокруг того же сустава, что и бёдра: так нога
    // покачивается целиком, не разваливаясь в колене
    { id: 'shinR', uv: [0, 22], from: [0, KNEE_Y - SHIN, KNEE_Z - 2], to: [4, KNEE_Y, KNEE_Z + 2],
      pivot: [2, HIP_Y, 0] },
    { id: 'shinL', uv: [0, 22], from: [-4, KNEE_Y - SHIN, KNEE_Z - 2], to: [0, KNEE_Y, KNEE_Z + 2],
      pivot: [-2, HIP_Y, 0] }
  ];
  const PLAYER_HEAD = { uv: [0, 0], from: [-4, 12, -4], to: [4, 20, 4], pivot: [0, 12, 0] };

  // Суперсэмплинг: фигуру считаем втрое крупнее в отдельный холст и уменьшаем
  // при переносе. Так сглаживается контур, а текстура остаётся пиксельной —
  // обычное сглаживание размыло бы её в кашу.
  const SUPERSAMPLE = 3;

  // Трава и листва в Minecraft серые: их красит биом при отрисовке. Без тонировки
  // они и выходили серыми. Цвета — равнинный (plains) для травы и дуба для листвы.
  const TINT = {
    grass: '#91BD59',
    leaves: '#48B518'
  };

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  /**
   * Красит серую текстуру: multiply накладывает цвет, а destination-in
   * возвращает исходную форму — без него залился бы весь прямоугольник.
   */
  function tinted(img, color) {
    if (!img) return img;
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = color;
    x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(img, 0, 0);
    return c;
  }

  // ── Помощники 2.5D ────────────────────────────────────────────────────────

  function rotY(p, a, pivot) {
    const x = p[0] - pivot[0], z = p[2] - pivot[2];
    const c = Math.cos(a), s = Math.sin(a);
    return [pivot[0] + x * c + z * s, p[1], pivot[2] - x * s + z * c];
  }

  function rotX(p, a, pivot) {
    const y = p[1] - pivot[1], z = p[2] - pivot[2];
    const c = Math.cos(a), s = Math.sin(a);
    return [p[0], pivot[1] + y * c - z * s, pivot[2] + y * s + z * c];
  }

  /** Модель → экран. Ортографическая проекция с поворотом камеры. */
  function project(p) {
    const cy = Math.cos(VIEW_YAW), sy = Math.sin(VIEW_YAW);
    const cp = Math.cos(VIEW_PITCH), sp = Math.sin(VIEW_PITCH);
    const x1 = p[0] * cy + p[2] * sy;
    const z1 = -p[0] * sy + p[2] * cy;
    const y2 = p[1] * cp - z1 * sp;
    const z2 = p[1] * sp + z1 * cp;
    return [x1, -y2, z2];
  }

  /** Глубина нормали в системе камеры: > 0 — грань смотрит на зрителя. */
  function normalDepth(n) {
    const cy = Math.cos(VIEW_YAW), sy = Math.sin(VIEW_YAW);
    const cp = Math.cos(VIEW_PITCH), sp = Math.sin(VIEW_PITCH);
    const x1 = n[0] * cy + n[2] * sy;
    const z1 = -n[0] * sy + n[2] * cy;
    return n[1] * sp + z1 * cp;
  }

  /**
   * Раскладка коробки в текстуре Minecraft. Для коробки (w,h,d) со смещением (u,v):
   *   верх (u+d, v), низ (u+d+w, v), право (u, v+d),
   *   лицо (u+d, v+d), лево (u+d+w, v+d), тыл (u+2d+w, v+d)
   */
  function boxFaces(uv, w, h, d) {
    const u = uv[0], v = uv[1];
    return [
      ['front', [u + d, v + d, w, h]],
      ['back', [u + 2 * d + w, v + d, w, h]],
      ['right', [u, v + d, d, h]],
      ['left', [u + d + w, v + d, d, h]],
      ['top', [u + d, v, w, d]],
      ['bottom', [u + d + w, v, w, d]]
    ];
  }

  /** Углы граней коробки. Порядок TL, TR, BR, BL — как ложатся на текстуру. */
  function faceCorners(name, x0, y0, z0, x1, y1, z1) {
    switch (name) {
      case 'front':  return [[x1, y1, z1], [x0, y1, z1], [x0, y0, z1], [x1, y0, z1]];
      case 'back':   return [[x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0]];
      case 'right':  return [[x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]];
      case 'left':   return [[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]];
      case 'top':    return [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]];
      default:       return [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]];
    }
  }

  /**
   * Кладёт текстуру на параллелограмм грани. Ортографическая проекция
   * прямоугольника всегда даёт параллелограмм, поэтому хватает аффинного
   * преобразования — настоящая 3D-растеризация не нужна.
   */
  function drawQuad(ctx, tex, quad, uv, shade, dpr) {
    const p0 = quad[0], p1 = quad[1], p3 = quad[3];
    const sw = uv[2], sh = uv[3];
    const a = (p1[0] - p0[0]) / sw, b = (p1[1] - p0[1]) / sw;
    const c = (p3[0] - p0[0]) / sh, d = (p3[1] - p0[1]) / sh;
    if (Math.abs(a * d - c * b) < 1e-6) return;

    ctx.save();
    ctx.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, p0[0] * dpr, p0[1] * dpr);
    ctx.drawImage(tex, uv[0], uv[1], sw, sh, 0, 0, sw, sh);
    ctx.restore();

    // Освещение: затемняем грань по её ориентации. Заливка идёт под клипом
    // по контуру грани, поэтому соседние грани не затрагиваются.
    if (shade < 0.999) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const q of quad) {
        if (q[0] < minX) minX = q[0];
        if (q[1] < minY) minY = q[1];
        if (q[0] > maxX) maxX = q[0];
        if (q[1] > maxY) maxY = q[1];
      }
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(quad[0][0], quad[0][1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(quad[i][0], quad[i][1]);
      ctx.closePath();
      ctx.clip();
      ctx.fillStyle = `rgba(0,0,0,${(1 - shade).toFixed(3)})`;
      ctx.fillRect(minX - 1, minY - 1, maxX - minX + 2, maxY - minY + 2);
      ctx.restore();
    }
  }

  class Diorama {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.tex = null;
      this.tufts = [];
      this.clock = 0;
      this.player = null;
      // Куда смотрит игрок. По умолчанию — вверх: курсор обычно выше полоски
      this.pointer = { x: 0, y: -200 };
      this.tracking = false;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    }

    async load() {
      const entries = Object.entries(TEX_FILES);
      const imgs = await Promise.all(entries.map(([, f]) => loadImage(BASE + f)));
      this.tex = {};
      entries.forEach(([k], i) => { this.tex[k] = imgs[i]; });
      // Трава и листва в текстурах серые — в игре их красит биом, здесь некому
      this.tex.grass = tinted(this.tex.grass, TINT.grass);
      this.tex.leaves = tinted(this.tex.leaves, TINT.leaves);
      this.trackPointer();
      return !!this.tex.grassSide;
    }

    /** Следим за курсором в координатах холста — по нему поворачивается голова. */
    trackPointer() {
      if (this.tracking) return;
      this.tracking = true;
      document.addEventListener('pointermove', (e) => {
        if (!this.canvas.isConnected || this.canvas.style.display === 'none') return;
        const r = this.canvas.getBoundingClientRect();
        if (r.width < 2) return;
        this.pointer.x = e.clientX - r.left;
        this.pointer.y = e.clientY - r.top;
      }, { passive: true });
    }

    /**
     * Размер блока под текущую ширину: примерно тринадцать блоков в ряд.
     * Число подобрано так, чтобы по ВЫСОТЕ влезали пять блоков рельефа,
     * ствол и крона — при более крупном блоке дерево обрезалось сверху.
     */
    sizeFor(w) {
      return Math.max(9, Math.round(w / 13));
    }

    generate(w, h) {
      this.w = w;
      this.h = h;
      this.B = this.sizeFor(w);
      this.canvas.width = Math.round(w * this.dpr);
      this.canvas.height = Math.round(h * this.dpr);
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.ctx.imageSmoothingEnabled = false;   // текстуры должны остаться пиксельными

      const cols = Math.ceil(w / this.B) + 1;

      // Рельеф: несколько опорных точек и линейная интерполяция между ними.
      // Чистый случайный шаг даёт пилу, а так выходят пологие холмы.
      const anchors = 3 + Math.floor(Math.random() * 3);
      const ctrl = [];
      for (let i = 0; i <= anchors; i++) ctrl.push(1 + Math.floor(Math.random() * 5));
      this.heights = [];
      for (let i = 0; i < cols; i++) {
        const t = (i / Math.max(1, cols - 1)) * anchors;
        const a = Math.floor(t);
        const f = t - a;
        const v = ctrl[a] * (1 - f) + ctrl[Math.min(anchors, a + 1)] * f;
        this.heights.push(Math.max(1, Math.min(5, Math.round(v))));
      }

      // Гарантируем площадку под дерево. На холме в 4–5 блоков ствол с кроной
      // по высоте не влезает и обрезается сверху, а дерево нужно всегда —
      // под ним сидит игрок. Поэтому принудительно выравниваем участок у середины.
      const mid = Math.floor(cols / 2);
      for (let i = Math.max(1, mid - 2); i <= Math.min(cols - 2, mid + 1); i++) {
        this.heights[i] = Math.min(this.heights[i], 2);
      }

      this.buildStatic();
      this.placeLife();
    }

    surfaceY(col) {
      const height = this.heights[Math.min(this.heights.length - 1, Math.max(0, col))];
      return this.h - height * this.B;
    }

    /** Земля и дерево — один раз в отдельный холст. */
    buildStatic() {
      const layer = document.createElement('canvas');
      layer.width = this.canvas.width;
      layer.height = this.canvas.height;
      const ctx = layer.getContext('2d');
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;

      const t = this.tex;
      for (let i = 0; i < this.heights.length; i++) {
        const x = i * this.B;
        const topY = this.surfaceY(i);
        if (t.grassSide) ctx.drawImage(t.grassSide, x, topY, this.B, this.B);
        for (let y = topY + this.B; y < this.h; y += this.B) {
          if (t.dirt) ctx.drawImage(t.dirt, x, y, this.B, this.B);
        }
      }

      this.treeCol = this.pickTreeSpot();
      if (this.treeCol >= 0) this.drawTree(ctx, this.treeCol);

      this.layer = layer;
    }

    /**
     * Место под дуб. Только на НИЗКОМ месте: на холме в 4–5 блоков ствол
     * с кроной по высоте не влезает в полоску. Площадка гарантирована
     * на этапе генерации рельефа, поэтому дерево находится всегда.
     */
    pickTreeSpot() {
      if (!this.tex.log || !this.tex.leaves) return -1;
      const spots = [];
      for (let i = 2; i < this.heights.length - 4; i++) {
        if (this.heights[i] > 2) continue;
        if (this.heights[i] === this.heights[i + 1]) spots.push(i);
      }
      if (!spots.length) return -1;
      // Предпочитаем место ближе к середине, чтобы игроку было где сесть
      spots.sort((a, b) => Math.abs(a - this.heights.length / 2) - Math.abs(b - this.heights.length / 2));
      return spots[Math.floor(Math.random() * Math.min(3, spots.length))];
    }

    /**
     * Дуб: ствол в четыре-пять блоков и трёхъярусная крона.
     * Ярусы сужаются кверху, а углы обрываются через раз — иначе выходит
     * не листва, а слоёный пирог.
     */
    drawTree(ctx, col) {
      const t = this.tex;
      const B = this.B;
      const x = col * B;
      const groundY = this.surfaceY(col);

      // Длину ствола считаем от свободного места: на крону уходит четыре блока,
      // остальное можно отдать стволу. Иначе верхушка уходит за край полоски.
      const room = Math.floor(this.surfaceY(col) / B) - 4;
      const trunk = Math.max(2, Math.min(4, room));

      for (let k = 1; k <= trunk; k++) {
        ctx.drawImage(t.log, x, groundY - k * B, B, B);
      }

      const topY = groundY - trunk * B;
      // Ярусы снизу вверх: широкий, средний, узкий
      const layers = [
        { dy: 0, half: 1, corner: 0.5 },
        { dy: -1, half: 2, corner: 0.7 },
        { dy: -2, half: 1, corner: 0.6 }
      ];
      for (const layer of layers) {
        for (let dx = -layer.half; dx <= layer.half; dx++) {
          const far = Math.abs(dx) === layer.half;
          if (far && Math.random() < layer.corner) continue;
          ctx.drawImage(t.leaves, x + dx * B, topY + layer.dy * B, B, B);
        }
      }
      // Верхушка — один блок, не всегда
      if (Math.random() < 0.7) {
        ctx.drawImage(t.leaves, x, topY - 3 * B, B, B);
      }
    }

    /** Трава, цветы и игрок — то, что потом шевелится. */
    placeLife() {
      this.tufts = [];
      const t = this.tex;
      for (let i = 0; i < this.heights.length; i++) {
        const x = i * this.B;
        // Под деревом и рядом с игроком траву не ставим — она их перекроет
        const nearTree = this.treeCol >= 0 && Math.abs(i - this.treeCol) <= 1;
        if (!nearTree && Math.random() < 0.38 && t.grass) {
          this.tufts.push({
            tex: t.grass, x: x + this.B * 0.12, col: i,
            phase: Math.random() * 6.28, kind: 'grass',
            scale: Math.random() < 0.28 ? 1.35 : 1   // попадаются пучки повыше
          });
        }
        // Цветы растут полянками: завёлся один — рядом появятся ещё
        if (!nearTree && Math.random() < 0.07 && t.poppy) {
          const extra = Math.random() < 0.6 ? 1 : 0;
          for (let k = 0; k <= extra && i + k < this.heights.length; k++) {
            const tex = Math.random() < 0.5 ? t.poppy : t.dandelion;
            this.tufts.push({
              tex, x: (i + k) * this.B + this.B * 0.25, col: i + k,
              phase: Math.random() * 6.28, kind: 'flower', scale: 1
            });
          }
        }
      }

      // Игрок. Дерево нашлось — садится у ствола, иначе просто на ровном месте:
      // фигура должна быть в сцене всегда, а не только при удачном рельефе.
      if (this.tex.steve) {
        let col;
        if (this.treeCol >= 0) {
          const side = this.treeCol < this.heights.length / 2 ? 1.6 : -1.6;
          col = this.treeCol + side;
        } else {
          col = 2 + Math.random() * (this.heights.length - 5);
        }
        this.player = { col: Math.max(1, Math.min(this.heights.length - 2, col)) };
      } else {
        this.player = null;
      }
    }

    frame(dt) {
      this.clock += dt;
      const ctx = this.ctx;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, this.w, this.h);
      if (this.layer) ctx.drawImage(this.layer, 0, 0, this.w, this.h);

      // Трава и цветы: лёгкое качание, у цветов меньше — они жёстче
      for (const tf of this.tufts) {
        const y = this.surfaceY(tf.col);
        const amp = tf.kind === 'flower' ? 0.06 : 0.14;
        const tilt = Math.sin(this.clock * 1.3 + tf.phase) * amp;
        const size = this.B * (tf.scale || 1);
        ctx.save();
        ctx.translate(tf.x + this.B * 0.44, y);
        // Сдвиг верхушки: нижний край остаётся на земле, гнётся только верх
        ctx.transform(1, 0, tilt, 1, 0, 0);
        ctx.drawImage(tf.tex, -size * 0.44, -size, size, size);
        ctx.restore();
      }

      if (this.player) this.drawPlayer(ctx);
    }

    /**
     * Сидящий Стив в 2.5D.
     *
     * Собираем грани всех коробок модели, отсекаем отвёрнутые от камеры,
     * сортируем по глубине и рисуем дальние первыми. Голова — единственная
     * вращающаяся часть: её углы поворачиваются вокруг оси шеи на угол,
     * посчитанный по положению курсора.
     */
    drawPlayer(ctx) {
      const tex = this.tex.steve;
      if (!tex) return;

      const B = this.B;
      const SS = SUPERSAMPLE;
      // Чуть крупнее блока: в мелком спрайте иначе не разобрать ни лицо, ни позу
      const scale = (B / 16) * 1.14;
      const col = Math.round(this.player.col);
      const groundY = this.surfaceY(col);
      const ox = col * B + B * 0.5;
      // Дыхание: очень слабый подъём-опускание, чтобы фигура не была замороженной
      const breathe = Math.sin(this.clock * 1.3) * scale * 0.22;
      const oy = groundY + breathe;

      // Куда смотрит: направление от центра головы к курсору.
      // tanh мягко подводит угол к пределу: на краю нет рывка, и шея не
      // выворачивается, как было с жёстким ограничением на 70°.
      const hs = project([0, 16, 0]);
      const headX = ox + hs[0] * scale;
      const headY = oy + hs[1] * scale;
      const dx = (this.pointer.x - headX) / 130;
      const dy = (this.pointer.y - headY) / 130;
      const yaw = Math.tanh(dx) * HEAD_YAW_LIMIT;
      const pitch = Math.tanh(dy) * (dy < 0 ? HEAD_PITCH_UP : HEAD_PITCH_DOWN);

      // Ноги и руки покачиваются вразнобой — фигура выглядит живой
      const swing = Math.sin(this.clock * 2.1) * 5.5 * Math.PI / 180;
      const armSwing = swing * 0.45;

      // Считаем фигуру в отдельном холсте втрое крупнее, потом уменьшаем:
      // так сглаживается контур, а текстура остаётся пиксельной
      const ow = Math.ceil(B * 3.2 * SS);
      const oh = Math.ceil(B * 2.6 * SS);
      if (!this.pcanvas) {
        this.pcanvas = document.createElement('canvas');
        this.pctx = this.pcanvas.getContext('2d');
      }
      const pc = this.pcanvas;
      if (pc.width !== ow || pc.height !== oh) {
        pc.width = ow;
        pc.height = oh;
      }
      const pctx = this.pctx;
      pctx.setTransform(1, 0, 0, 1, 0, 0);
      pctx.clearRect(0, 0, ow, oh);
      pctx.imageSmoothingEnabled = false;

      // Начало модели внутри этого холста: по центру, низ — на земле
      const pox = ow * 0.5;
      const poy = oh - B * 0.6 * SS;

      const faces = [];
      for (const box of PLAYER_BODY) {
        let partPitch = 0;
        if (box.id === 'thighR' || box.id === 'shinR') partPitch = swing;
        else if (box.id === 'thighL' || box.id === 'shinL') partPitch = -swing;
        else if (box.id === 'armR') partPitch = armSwing;
        else if (box.id === 'armL') partPitch = -armSwing;
        this.collectBox(faces, box, 0, partPitch, pox, poy, scale * SS);
      }
      this.collectBox(faces, PLAYER_HEAD, yaw, pitch, pox, poy, scale * SS);

      faces.sort((a, b) => a.depth - b.depth);   // дальние сначала
      for (const f of faces) {
        drawQuad(pctx, tex, f.quad, f.uv, f.shade, 1);
      }

      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(pc, 0, 0, ow, oh,
        ox - pox / SS, oy - poy / SS, ow / SS, oh / SS);
      ctx.restore();
    }

    /** Собирает видимые грани коробки с учётом её позы и поворота. */
    collectBox(out, box, yaw, pitch, ox, oy, scale) {
      const bx0 = box.from[0], by0 = box.from[1], bz0 = box.from[2];
      const bx1 = box.to[0], by1 = box.to[1], bz1 = box.to[2];
      const pivot = box.pivot || [0, 0, 0];
      // baseRot — поза самой части (наклон бедра или плеча), pitch — покачивание
      const totalX = (box.baseRot || 0) + pitch;
      const rot = (p) => rotX(rotY(p, yaw, pivot), totalX, pivot);

      for (const [name, uv] of boxFaces(box.uv, bx1 - bx0, by1 - by0, bz1 - bz0)) {
        let corners = faceCorners(name, bx0, by0, bz0, bx1, by1, bz1);
        let n = FACE_NORMAL[name];
        if (yaw !== 0 || totalX !== 0) {
          corners = corners.map(rot);
          n = rotX(rotY(n, yaw, [0, 0, 0]), totalX, [0, 0, 0]);
        }
        // Грань отвёрнута от камеры — не рисуем
        if (normalDepth(n) <= 0.02) continue;

        const quad = corners.map((c) => {
          const r = project(c);
          return [ox + r[0] * scale, oy + r[1] * scale, r[2]];
        });
        const depth = (quad[0][2] + quad[1][2] + quad[2][2] + quad[3][2]) * 0.25;
        out.push({ depth, quad, uv, shade: FACE_SHADE[name] });
      }
    }
  }

  return { Diorama };
})();
