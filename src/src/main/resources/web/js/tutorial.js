/* ── Обучение ─────────────────────────────────────────────────────────────────
   Пошаговый разбор интерфейса. Подсвечивает то, что нужно нажать, и ведёт
   окошком-сообщением.

   Главное правило: обучение НИКОГДА не запирает игрока. Затемнение не ловит
   клики (pointer-events: none), поэтому нажимать можно что угодно. Если игрок
   ушёл в сторону от шага, обучение не сбрасывается и не ругается — оно
   сворачивается в уголок, показывает случайную фразу ожидания и ждёт
   возвращения. Вернулся — предлагает продолжить с того же места.

   Шаги описаны ниже, тексты живут в js/i18n.js под ключами tut.*.
*/

(function () {
  'use strict';

  const TICK_MS = 220;        // как часто сверяемся с состоянием и положением
  const GRACE_MS = 1500;      // сколько ждём, прежде чем счесть состояние ушедшим
  const CARD_GAP = 14;        // зазор между подсветкой и окошком
  const SPOT_PAD = 6;         // насколько подсветка шире элемента

  /* Шаги. Порядок — сначала Vanilla, потом vulkan, в конце предложение
     показать дополнительное.

     ready()  — состояние, в котором шаг уместен: и вкладка, и режим.
                Перестало выполняться — сворачиваемся в уголок и ждём.
                Проверять одну вкладку мало: без неё обучение считало уход в
                настройки нормальным и молча пролистывало шаги, у которых цель
                стала невидимой, — то есть ровно то, чего оно делать не должно.
     done()   — ожидаемое действие игрока. Как только оно случилось, шаг
                засчитывается сам, без кнопки «дальше».
     Если done нет — шаг листается кнопкой. */
  function buildSteps() {
    const inVanilla = () => currentMode === 'vanilla';
    const inPulse = () => currentMode === 'pulse';
    const onTab = (name) => () => typeof currentTab !== 'undefined' && currentTab === name;

    return [
      // ── Основной круг: Vanilla ─────────────────────────────────────────────
      { id: 's1', target: '#vanillaModeBtn', ready: onTab('play'),
        title: 'tut.s1.title', body: 'tut.s1.body', done: inVanilla },
      { id: 's2', target: '#versionsCard', ready: () => onTab('play')() && inVanilla(),
        title: 'tut.s2.title', body: 'tut.s2.body',
        done: () => inVanilla() && !!document.querySelector('#versionList .version-item.active') },
      { id: 's3', target: '#launchBtn', ready: () => onTab('play')() && inVanilla(),
        title: 'tut.s3.title', body: 'tut.s3.body' },
      { id: 's4', target: '#versionSummary', ready: () => onTab('play')() && inVanilla(),
        title: 'tut.s4.title', body: 'tut.s4.body' },
      { id: 's5', target: '.nav-btn:nth-child(2)', ready: () => true,
        title: 'tut.s5.title', body: 'tut.s5.body', done: onTab('mods') },
      { id: 's6', target: '#modSourceSwitch', ready: onTab('mods'),
        title: 'tut.s6.title', body: 'tut.s6.body' },
      { id: 's7', target: '#modCategories', ready: onTab('mods'),
        title: 'tut.s7.title', body: 'tut.s7.body' },
      { id: 's8', target: '#browserModsList .browser-mod-row', ready: onTab('mods'),
        title: 'tut.s8.title', body: 'tut.s8.body',
        done: () => !!document.querySelector('.browser-mod-row button') },
      /* Целей две: и каталог из интернета, и список установленных. Игрок волен
         нажать любую строку — и та и другая открывают описание. */
      { id: 's9', target: ['#browserModsList .browser-mod-row', '#modsList .mod-row'], ready: onTab('mods'),
        title: 'tut.s9.title', body: 'tut.s9.body',
        done: () => document.getElementById('modDetail') &&
                    document.getElementById('modDetail').dataset.open === 'true' },
      { id: 's10', target: '#modsList .mod-row', ready: onTab('mods'),
        title: 'tut.s10.title', body: 'tut.s10.body' },
      { id: 's11', target: '#modsSpeedUpBtn', ready: onTab('mods'),
        title: 'tut.s11.title', body: 'tut.s11.body' },
      { id: 's12', target: '.nav-btn:nth-child(3)', ready: () => true,
        title: 'tut.s12.title', body: 'tut.s12.body', done: onTab('settings') },
      { id: 's13', target: '#ramSlider', ready: onTab('settings'),
        title: 'tut.s13.title', body: 'tut.s13.body' },
      { id: 's14', target: '#langSelect', ready: onTab('settings'),
        title: 'tut.s14.title', body: 'tut.s14.body' },
      { id: 's15', target: '#accountBar', ready: () => true,
        title: 'tut.s15.title', body: 'tut.s15.body' },

      // ── Основной круг: vulkan ──────────────────────────────────────────────
      { id: 'v1', target: '#pulseModeBtn', ready: () => true,
        title: 'tut.v1.title', body: 'tut.v1.body', done: inPulse },
      { id: 'v2', target: '#heroTitle', ready: () => onTab('play')() && inPulse(),
        title: 'tut.v2.title', body: 'tut.v2.body' },
      { id: 'v3', target: '#pulseLockCard', ready: () => onTab('play')() && inPulse(),
        title: 'tut.v3.title', body: 'tut.v3.body' },
      { id: 'v4', target: '.nav-btn:nth-child(2)', ready: () => onTab('play')() && inPulse(),
        title: 'tut.v4.title', body: 'tut.v4.body' },

      // ── Дополнительное ─────────────────────────────────────────────────────
      { id: 'e1', target: '#musicCard', ready: () => currentTab === 'play',
        title: 'tut.e1.title', body: 'tut.e1.body', extra: true },
      { id: 'e2', target: '#bytebeatBtn', ready: () => currentTab === 'play',
        title: 'tut.e2.title', body: 'tut.e2.body', extra: true },
      { id: 'e3', target: '#spotifyBtn', ready: () => currentTab === 'play',
        title: 'tut.e3.title', body: 'tut.e3.body', extra: true },
      { id: 'e4', target: '#detailFlags',
        ready: () => onTab('mods')() && document.getElementById('modDetail') &&
                      document.getElementById('modDetail').dataset.open === 'true',
        title: 'tut.e4.title', body: 'tut.e4.body', extra: true },
      { id: 'e5', target: '#modsUpdateBtn', ready: onTab('mods'),
        title: 'tut.e5.title', body: 'tut.e5.body', extra: true },
      { id: 'e6', target: '#logToggle', ready: () => currentTab === 'play',
        title: 'tut.e6.title', body: 'tut.e6.body', extra: true }
    ];
  }

  class Tutorial {
    constructor() {
      this.steps = buildSteps();
      this.index = 0;
      this.running = false;
      this.collapsed = false;
      this.resumeOffered = false;
      this.timer = 0;
      this.waitPhrase = 1;
      this.revealed = null;  // к какой цели уже прокручивали
      this.phase = 'idle';   // idle | intro | steps | finish | done
      /* Подпись того, что сейчас нарисовано в окошке. Пока она не менялась,
         окошко не пересобираем: кнопки, пересоздаваемые каждые двести
         миллисекунд, теряют клики — нажатие попадает в момент подмены
         элемента, и браузер не выдаёт click вовсе. */
      this.drawn = null;
      this.awaySince = 0;    // с какого момента состояние шага не выполняется
      this.hiddenSince = 0;  // с какого момента цель шага не видна
      this.build();
    }

    /* ── Разметка ─────────────────────────────────────────────────────────── */
    build() {
      if (document.getElementById('tutLayer')) return;

      const layer = document.createElement('div');
      layer.id = 'tutLayer';
      layer.innerHTML =
        '<div id="tutSpot" hidden></div>' +
        '<div id="tutCard" hidden>' +
          '<div class="tut-head">' +
            '<span class="tut-step" id="tutStep"></span>' +
            '<button class="tut-x" id="tutClose" type="button">✕</button>' +
          '</div>' +
          '<div class="tut-title" id="tutTitle"></div>' +
          '<div class="tut-body" id="tutBody"></div>' +
          '<div class="tut-actions" id="tutActions"></div>' +
        '</div>' +
        '<button id="tutChip" type="button" hidden>' +
          '<span class="tut-chip-dot"></span><span id="tutChipText"></span>' +
        '</button>';
      document.body.appendChild(layer);

      this.spot = layer.querySelector('#tutSpot');
      this.card = layer.querySelector('#tutCard');
      this.chip = layer.querySelector('#tutChip');
      this.elStep = layer.querySelector('#tutStep');
      this.elTitle = layer.querySelector('#tutTitle');
      this.elBody = layer.querySelector('#tutBody');
      this.elActions = layer.querySelector('#tutActions');
      this.elChipText = layer.querySelector('#tutChipText');

      layer.querySelector('#tutClose').onclick = () => this.stop();
      this.chip.onclick = () => this.expand();
    }

    /* ── Управление ───────────────────────────────────────────────────────── */
    start(options) {
      const fresh = !options || options.fromStart !== false;
      if (fresh) { this.index = 0; this.phase = 'intro'; }
      this.running = true;
      this.collapsed = false;
      this.resumeOffered = false;
      this.tick();
      clearInterval(this.timer);
      this.timer = setInterval(() => this.tick(), TICK_MS);
      report('tutorialStarted');
    }

    stop() {
      this.running = false;
      clearInterval(this.timer);
      this.timer = 0;
      this.disarmTarget();
      this.drawn = null;
      this.awaySince = 0;
      this.hiddenSince = 0;
      this.spot.hidden = true;
      this.card.hidden = true;
      this.chip.hidden = true;
      report('tutorialClosed');
    }

    /* Свернуться в уголок. Не остановка: обучение ждёт, пока игрок вернётся
       к тому месту, о котором шла речь. */
    collapse() {
      if (this.collapsed || !this.running) return;
      this.collapsed = true;
      this.resumeOffered = false;
      this.spot.hidden = true;
      this.card.hidden = true;
      this.chip.hidden = false;
      // Фраза выбирается заново при каждом сворачивании — иначе одно и то же
      // «Ожидание…» на третий раз начинает раздражать
      this.waitPhrase = 1 + Math.floor(Math.random() * 15);
      this.elChipText.textContent = t('tut.wait.' + this.waitPhrase);
      report('tutorialCollapsed');
    }

    /* Развернуться. Вызывается и возвращением игрока на нужное место, и
       нажатием на уголок. В обоих случаях предлагаем выбор, а не тащим дальше
       молча. */
    expand() {
      if (!this.running || !this.collapsed) return;
      this.collapsed = false;
      this.chip.hidden = true;
      this.resumeOffered = true;
      this.tick();
      report('tutorialResumed');
    }

    get current() {
      const step = this.steps[this.index];
      return step || null;
    }

    /* ── Основной цикл ────────────────────────────────────────────────────── */
    tick() {
      if (!this.running) return;

      if (this.phase === 'intro') { this.renderIntro(); return; }
      if (this.phase === 'finish') { this.renderFinish(); return; }
      if (this.phase === 'done') { this.renderDone(); return; }

      const step = this.current;
      if (!step) { this.phase = 'finish'; this.renderFinish(); return; }

      /* Отсрочка перед сворачиванием. Состояние успевает мигнуть: вкладка
         переключается, список перерисовывается, элемент на мгновение исчезает.
         Мгновенная реакция на такой провал выглядела бы как «нажал правильно,
         а он обиделся и ушёл ждать». */
      const ready = !step.ready || step.ready();
      const now = Date.now();

      /* Свёрнутое состояние: как только игрок вернулся туда, о чём шла речь,
         обучение разворачивается САМО и предлагает продолжить. Ждать нажатия
         на уголок было бы неправильно — уголок это запасной выход для тех, кто
         хочет вернуть обучение руками, а не единственный способ. */
      if (this.collapsed) {
        if (ready) this.expand();
        return;
      }

      if (!ready) {
        if (!this.awaySince) this.awaySince = now;
        if (now - this.awaySince >= GRACE_MS) { this.awaySince = 0; this.collapse(); }
        return;
      }
      this.awaySince = 0;

      // Ожидаемое действие выполнено — шаг засчитан сам
      if (step.done && step.done()) { this.advance(); return; }

      this.renderStep(step);
    }

    advance() {
      this.index++;
      this.resumeOffered = false;
      this.drawn = null;
      this.revealed = null;
      this.disarmTarget();
      const next = this.current;
      // Основной круг кончился — предлагаем дополнительное
      if (!next || (next.extra && !this.showingExtra)) {
        this.phase = 'finish';
      }
      if (next && next.extra && !this.showingExtra) this.index--;
      this.tick();
    }

    /* ── Отрисовка ────────────────────────────────────────────────────────── */

    /* Окошко ставим рядом с подсветкой, выбирая сторону, где больше места.
       Если элементы на экране двигаются, оно переезжает вместе с ними. */
    place(target) {
      const pad = SPOT_PAD;
      const r = target.getBoundingClientRect();
      this.spot.hidden = false;
      this.spot.style.left = (r.left - pad) + 'px';
      this.spot.style.top = (r.top - pad) + 'px';
      this.spot.style.width = (r.width + pad * 2) + 'px';
      this.spot.style.height = (r.height + pad * 2) + 'px';
      this.spot.style.borderRadius = getComputedStyle(target).borderRadius || '10px';

      const card = this.card;
      card.hidden = false;
      const cw = card.offsetWidth || 320;
      const ch = card.offsetHeight || 160;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let x = r.left + r.width / 2 - cw / 2;
      let y = r.bottom + CARD_GAP;
      // Не влезло снизу — ставим сверху
      if (y + ch > vh - 8) y = r.top - ch - CARD_GAP;
      // Не влезло и сверху — прижимаем к нижнему краю
      if (y < 8) y = Math.max(8, vh - ch - 8);
      x = Math.max(8, Math.min(vw - cw - 8, x));

      card.style.left = x + 'px';
      card.style.top = y + 'px';
    }

    button(label, onClick, kind) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tut-btn' + (kind ? ' ' + kind : '');
      b.textContent = label;
      b.onclick = onClick;
      return b;
    }

    renderIntro() {
      this.drawn = null;
      // Приветствие: первым делом язык — на нём будет и лаунчер, и обучение
      this.spot.hidden = true;
      this.card.hidden = false;
      this.card.style.left = Math.max(8, (window.innerWidth - 380) / 2) + 'px';
      this.card.style.top = Math.max(8, (window.innerHeight - 220) / 2) + 'px';
      this.elStep.textContent = '';
      this.elTitle.textContent = t('tut.welcomeTitle');
      this.elBody.textContent = t('tut.welcomeBody');

      this.elActions.textContent = '';
      const row = document.createElement('div');
      row.className = 'tut-langs';
      for (const l of I18N.langs) {
        const b = this.button(l.label, () => {
          I18N.setLang(l.code);
          if (window.saveLanguage) window.saveLanguage(l.code);
          this.phase = 'steps';
          this.tick();
        }, I18N.lang === l.code ? 'accent' : '');
        row.appendChild(b);
      }
      this.elActions.appendChild(row);
      this.elActions.appendChild(
        this.button(t('tut.notNow'), () => this.stop()));
    }

    /* Шаг без ожидаемого действия листается кнопкой. Но игрок видит подсветку
       и жмёт именно то, что подсвечено, — поэтому клик по цели тоже засчитываем.
       Слушатель одноразовый и снимается вместе со сменой шага. */
    armTarget(target) {
      if (this.armed === target) return;
      this.disarmTarget();
      this.armed = target;
      this.armedHandler = (e) => {
        if (e.target.closest('#tutCard, #tutChip')) return;
        this.advance();
      };
      target.addEventListener('click', this.armedHandler, true);
    }

    disarmTarget() {
      if (this.armed && this.armedHandler) {
        this.armed.removeEventListener('click', this.armedHandler, true);
      }
      this.armed = null;
      this.armedHandler = null;
    }

    /* У шага может быть несколько равнозначных целей. Берём первую, которая
       есть и видна: список модов из интернета и список установленных лежат в
       разных местах страницы, и угадывать, куда смотрит игрок, не нужно. */
    pickTarget(step) {
      const list = Array.isArray(step.target) ? step.target : [step.target];
      let firstExisting = null;
      for (const sel of list) {
        const el = document.querySelector(sel);
        if (!el) continue;
        if (!firstExisting) firstExisting = el;
        const r = el.getBoundingClientRect();
        if (r.width >= 2 && r.height >= 2) return el;
      }
      return firstExisting;
    }

    /* Прокрутить к цели, если она уехала за край. Делаем это один раз на шаг:
       иначе плавная прокрутка дралась бы с собственной прокруткой игрока. */
    revealTarget(step, target) {
      if (this.revealed === step.id) return;
      const r = target.getBoundingClientRect();
      const fits = r.top >= 60 && r.bottom <= window.innerHeight - 20;
      if (fits) { this.revealed = step.id; return; }
      this.revealed = step.id;
      try {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch (_) {
        target.scrollIntoView();   // старые движки без опций
      }
    }

    renderStep(step) {
      const target = this.pickTarget(step);
      /* Цели может не быть вовсе: список модов приходит из сети уже после
         открытия вкладки. Пропустить шаг из-за этого — значит выкинуть его
         молча, поэтому сначала ждём; пропускаем только если не дождались. */
      if (!target) {
        if (!this.hiddenSince) this.hiddenSince = Date.now();
        if (Date.now() - this.hiddenSince < GRACE_MS) return;
        this.hiddenSince = 0;
        this.advance();
        return;
      }
      this.revealTarget(step, target);

      /* Цель есть, но не видна. Часть кнопок помечена vanilla-only и в режиме
         чита просто не отображается — такую цель надо пропустить. Но элемент
         бывает невидим и секунду-другую после переключения вкладки, пока
         страница дорисовывается, и пропускать шаг из-за этого нельзя. Поэтому
         сначала ждём. */
      const box = target.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) {
        if (!this.hiddenSince) this.hiddenSince = Date.now();
        if (Date.now() - this.hiddenSince < GRACE_MS) return;
        this.hiddenSince = 0;
        this.advance();
        return;
      }
      this.hiddenSince = 0;

      this.place(target);

      if (step.done) this.disarmTarget();
      else this.armTarget(target);

      const total = this.steps.filter((s) => !s.extra).length;
      const shown = Math.min(this.index + 1, total);

      /* Подпись нарисованного. Пока она та же, содержимое окошка не трогаем:
         пересборка кнопок на каждом тике съедала клики. */
      const stamp = [this.index, this.resumeOffered, I18N.lang].join('|');
      if (this.drawn === stamp) return;
      this.drawn = stamp;

      this.elStep.textContent = t('tut.step', { n: shown, total });
      this.elTitle.textContent = t(step.title);
      this.elBody.textContent = t(step.body);

      this.elActions.textContent = '';
      if (this.resumeOffered) {
        // Вернулся после сворачивания — спрашиваем, а не тащим дальше
        this.elTitle.textContent = t('tut.resumeTitle');
        this.elBody.textContent = t('tut.resumeBody', { step: t(step.title) });
        this.elActions.appendChild(this.button(t('tut.resume'), () => {
          this.resumeOffered = false; this.tick();
        }, 'accent'));
        this.elActions.appendChild(this.button(t('tut.restart'), () => {
          this.resumeOffered = false;
          this.index = 0; this.phase = 'steps'; this.tick();
        }));
        return;
      }

      if (!step.done) {
        this.elActions.appendChild(this.button(t('common.next'), () => this.advance(), 'accent'));
      }
      this.elActions.appendChild(this.button(t('common.skip'), () => this.stop()));
    }

    renderFinish() {
      this.drawn = null;
      this.spot.hidden = true;
      this.card.hidden = false;
      this.card.style.left = Math.max(8, (window.innerWidth - 380) / 2) + 'px';
      this.card.style.top = Math.max(8, (window.innerHeight - 220) / 2) + 'px';
      this.elStep.textContent = '';
      this.elTitle.textContent = t('tut.finishTitle');
      this.elBody.textContent = t('tut.finishBody');
      this.elActions.textContent = '';
      this.elActions.appendChild(this.button(t('tut.showExtra'), () => {
        this.showingExtra = true;
        const first = this.steps.findIndex((s) => s.extra);
        this.index = first < 0 ? this.steps.length : first;
        this.phase = 'steps';
        this.tick();
      }, 'accent'));
      this.elActions.appendChild(this.button(t('tut.thatIsAll'), () => {
        this.phase = 'done'; this.tick();
      }));
    }

    renderDone() {
      this.drawn = null;
      this.spot.hidden = true;
      this.card.hidden = false;
      this.elStep.textContent = '';
      this.elTitle.textContent = t('tut.extraDoneTitle');
      this.elBody.textContent = t('tut.extraDoneBody');
      this.elActions.textContent = '';
      this.elActions.appendChild(this.button(t('tut.close'), () => this.stop(), 'accent'));
    }
  }

  /* Сообщаем наружу, что обучение тронули: лаунчер запоминает это в настройках,
     чтобы не запускать обучение при каждом старте. */
  function report(what) {
    try {
      if (window.pulse && typeof window.pulse.tutorialEvent === 'function') {
        window.pulse.tutorialEvent(what);
      }
    } catch (error) {
      console.warn('[tutorial] не удалось сообщить наружу:', error.message);
    }
    document.dispatchEvent(new CustomEvent('tutorial:' + what));
  }

  let instance = null;

  window.Tutorial = {
    get instance() { return instance; },
    /* Запуск. force — из настроек, когда игрок сам просит пройти заново. */
    start(force) {
      if (!instance) instance = new Tutorial();
      instance.showingExtra = false;
      instance.start(force ? {} : { fromStart: true });
    },
    stop() { if (instance) instance.stop(); },
    get running() { return !!instance && instance.running; }
  };

  /* Первый запуск: обучение показываем один раз. Дальше — только из настроек. */
  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      let seen = false;
      try { seen = localStorage.getItem('vulkan.tutorialSeen') === '1'; } catch (_) { /* приватный режим */ }
      if (!seen && !IS_FILE_PREVIEW) window.Tutorial.start(false);
    }, 1400);
    /* report() шлёт события с префиксом tutorial: — слушатель обязан ждать
       то же самое имя, иначе отметка о показе не сохраняется и обучение
       лезет при каждом запуске лаунчера. */
    document.addEventListener('tutorial:tutorialClosed', () => {
      try { localStorage.setItem('vulkan.tutorialSeen', '1'); } catch (_) { /* не страшно */ }
    });
  });
})();
