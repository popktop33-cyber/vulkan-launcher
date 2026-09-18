'use strict';
/*
 * Вращающаяся 3D-модель скина — для окна предпросмотра в каталоге.
 *
 * Зачем. В сетке видна только голова: её хватает, чтобы узнать скин, но не
 * чтобы выбрать. Развёртка целиком (как было раньше) показывает текстуру, но
 * не показывает, КАК она сидит на фигуре: где шов, где второй слой, что
 * получится со спины. Поэтому здесь настоящая модель из коробок, которую
 * можно крутить мышью.
 *
 * Второго рендерера тут нет. Счёт граней, раскладка атласа, аффинная натяжка
 * текстуры и освещение берутся из Scene — те же самые, которыми рисуется
 * диорама. Своё здесь только одно: стоячая поза вместо сидячей и камера,
 * которую двигает игрок.
 *
 * ПОЧЕМУ МОДЕЛЬ СДВИНУТА ПО Y. Диорама ставит фигуру низом на землю, а камера
 * у неё фиксированная. Здесь камера вращается, и вращать надо вокруг середины
 * фигуры: если оставить начало координат в пятках, при наклоне модель уедет
 * за край холста. Поэтому все коробки сдвинуты на 16 юнитов вниз — центр
 * фигуры попадает в ноль, и поворот идёт вокруг него.
 */
const SkinView = (() => {

  // Суперсэмплинг: считаем втрое крупнее, показываем втрое мельче. Так
  // сглаживается контур, а текстура остаётся пиксельной — обычное сглаживание
  // размыло бы её в кашу. Тот же приём и та же кратность, что в диораме.
  const SS = 3;

  // Дальше ~62° фигура читается как «лёг и смотрим снизу» — предел мягкий,
  // потому что за него тянет сам игрок и упор должен чувствоваться, а не бить
  const PITCH_LIMIT = 62 * Math.PI / 180;

  // Фигура занимает 33 юнита в высоту, но при наклоне камеры её проекция
  // становится выше, а в ширину она доходит до 16. Делитель подобран так,
  // чтобы фигура занимала почти весь холст и при этом не срезалась на краях
  // ни в одном положении камеры.
  const FIT = 38;

  const SPIN_SPEED = 0.6;          // рад/с: полный оборот примерно за 10 секунд
  const DRAG_YAW = 0.011;          // рад на пиксель протяжки
  const DRAG_PITCH = 0.009;

  /**
   * Стоячая фигура.
   *
   * Координаты в юнитах, 16 юнитов = блок, y сдвинут на 16 вниз (см. выше).
   * Развёртка — каноническая раскладка Minecraft 64x64: у каждой части своя
   * пара координат в атласе, а у левых руки и ноги она СВОЯ, не зеркало
   * правых. Это ловушка: зеркалить их нельзя, у левых частей в атласе
   * собственные места.
   *
   * Крой учитывается только у рук: у тонкой модели они на пиксель уже. Всё
   * остальное одинаково.
   */
  function parts(slim) {
    const arm = slim ? 3 : 4;      // ширина руки в пикселях атласа
    const R0 = 4, R1 = R0 + arm;   // правая рука: от торса наружу
    const L1 = -R0, L0 = L1 - arm; // левая: наружу в другую сторону

    return [
      // ── первый слой ──
      { uv: [0, 0],    from: [-4, 8, -4],        to: [4, 16, 4] },
      { uv: [16, 16],  from: [-4, -4, -2],       to: [4, 8, 2] },
      { uv: [40, 16],  from: [R0, -4, -2],       to: [R1, 8, 2] },
      { uv: [32, 48],  from: [L0, -4, -2],       to: [L1, 8, 2] },
      { uv: [0, 16],   from: [0, -16, -2],       to: [4, -4, 2] },
      { uv: [16, 48],  from: [-4, -16, -2],      to: [0, -4, 2] },

      // ── второй слой: шляпа, куртка, рукава, штанины ──
      //
      // Тот же коробки, выпущенные наружу ровно на столько, на сколько их
      // выпускает игра. Без этого слоя половина скинов каталога выглядит не
      // так, как в игре: у них вся одежда нарисована именно здесь, а первый
      // слой — голое тело под ней.
      //
      // Шляпа выходит на 0.5 со всех сторон, включая верх; остальное — на
      // 0.25 и только в бока. Это не произвол: так задано в самой модели.
      //
      // uvDim обязателен и равен размерам ОСНОВНОЙ части, а не своей коробки.
      // Развёртка второго слоя в атласе нарисована под тот же размер, что и
      // первый слой: шляпа — под 8x8x8, куртка — под 8x12x4. Возьми размер
      // своей выпущенной коробки, и boxFaces прочитает атлас со сдвигом:
      // шляпа закроет голову наполовину. Проверено на подкрашенном эталоне.
      { uv: [32, 0],   uvDim: [8, 8, 8],      from: [-4.5, 7.5, -4.5],  to: [4.5, 16.5, 4.5] },
      { uv: [16, 32],  uvDim: [8, 12, 4],     from: [-4.25, -4, -2.25], to: [4.25, 8, 2.25] },
      { uv: [40, 32],  uvDim: [arm, 12, 4],   from: [R0 - 0.25, -4, -2.25], to: [R1 + 0.25, 8, 2.25] },
      { uv: [48, 48],  uvDim: [arm, 12, 4],   from: [L0 - 0.25, -4, -2.25], to: [L1 + 0.25, 8, 2.25] },
      { uv: [0, 32],   uvDim: [4, 12, 4],     from: [-0.25, -16, -2.25], to: [4.25, -4, 2.25] },
      { uv: [0, 48],   uvDim: [4, 12, 4],     from: [-4.25, -16, -2.25], to: [0.25, -4, 2.25] }
    ];
  }

  /**
   * Холст с моделью.
   *
   * opts.yaw / opts.pitch задают начальный ракурс, opts.auto выключает
   * самовращение. Нужны не для красоты: без них нельзя снять модель строго
   * спереди и со спины, а именно так и проверяется, что развёртки левых руки
   * и ноги взяты из атласа, а не отражены от правых.
   *
   * Возвращает объект с destroy(): без него витрина копила бы висящие
   * обработчики и кадры при каждом открытии предпросмотра.
   */
  function mount(canvas, url, slim, opts) {
    const o = opts || {};
    const ctx = canvas.getContext('2d');
    const cam = {
      // чуть вполоборота, как в диораме: так фигура читается объёмной сразу
      yaw: o.yaw === undefined ? -0.42 : o.yaw,
      pitch: o.pitch === undefined ? 0.14 : o.pitch
    };
    const boxes = parts(!!slim);

    let tex = null;
    let raf = 0;
    let last = 0;
    let dragging = false;
    // Крутить само перестаём, как только игрок взялся за мышь: дальше он
    // ведёт камеру сам, и вырывать её обратно было бы хамством
    let auto = o.auto !== false;

    function resize() {
      const r = canvas.getBoundingClientRect();
      const w = Math.max(64, Math.round(r.width));
      const h = Math.max(64, Math.round(r.height));
      if (canvas.width !== w * SS || canvas.height !== h * SS) {
        canvas.width = w * SS;
        canvas.height = h * SS;
      }
    }

    function frame() {
      resize();
      const w = canvas.width, h = canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = false;
      if (!tex) return;

      const scale = Math.min(w, h) / FIT;
      const ox = w * 0.5;
      const oy = h * 0.5;

      const faces = [];
      for (const box of boxes) {
        Scene.collectBox(faces, box, 0, 0, ox, oy, scale, tex, cam);
      }
      faces.sort((a, b) => a.depth - b.depth);   // дальние сначала
      for (const f of faces) {
        Scene.drawQuad(ctx, f.tex, f.quad, f.uv, f.shade, 1);
      }
    }

    function loop(now) {
      raf = requestAnimationFrame(loop);
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      if (auto && !dragging) cam.yaw += SPIN_SPEED * dt;
      frame();
    }

    // ── мышь ──

    function down(e) {
      dragging = true;
      auto = false;
      // Захват указателя может и не даться — например, если кнопку уже
      // отпустили. Это не повод ломать протяжку, поэтому глушим.
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      canvas.classList.add('sk-pv-grab');
      e.preventDefault();
    }

    function move(e) {
      if (!dragging) return;
      cam.yaw += e.movementX * DRAG_YAW;
      cam.pitch = Math.max(-PITCH_LIMIT,
                  Math.min(PITCH_LIMIT, cam.pitch - e.movementY * DRAG_PITCH));
      e.preventDefault();
    }

    function up(e) {
      dragging = false;
      canvas.classList.remove('sk-pv-grab');
      if (canvas.releasePointerCapture && e.pointerId !== undefined) {
        try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    }

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', up);

    // Скин берём только со своего бэкенда: чужая картинка «пачкает» холст, и
    // он перестаёт рисоваться вовсе (см. шапку skins.js).
    Scene.loadImage(url).then((img) => {
      tex = img;
      canvas.classList.toggle('sk-pv-missing', !img);
    });

    raf = requestAnimationFrame(loop);

    return {
      destroy() {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        canvas.removeEventListener('pointerdown', down);
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up);
        canvas.removeEventListener('pointercancel', up);
        canvas.removeEventListener('pointerleave', up);
      }
    };
  }

  return { mount };
})();
