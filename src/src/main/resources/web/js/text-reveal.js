/* ── Появление текста по буквам ───────────────────────────────────────────────
   Режет текст на символы и раздаёт каждому свой порядковый номер. Дальше всё
   делает CSS (см. блок «Появление текста по буквам» в style.css): буква
   всплывает из размытия с задержкой --i * --t-char-step.

   Шаг задержки зависит от длины строки, и это главное здесь. В дизайне он
   фиксированный — 12 мс, — но там шесть букв. В описании мода их может быть
   четыреста, и те же 12 мс растянули бы волну почти на пять секунд. Поэтому
   шаг ограничен сверху и снизу: короткие надписи получают крупный шаг,
   длинные — мелкий, а вся волна укладывается в TOTAL_MAX.
*/

(function () {
  'use strict';

  const STEP_MAX = 22;      // мс между буквами — предел для коротких надписей
  const TOTAL_MAX = 700;    // мс на всю волну, сколько бы букв ни было
  const DUR = 340;          // мс на одну букву
  const TARGETS = '[data-t-chars], [data-t-words]';

  /* Слово заворачиваем в отдельную обёртку, и это не украшение.

     Каждый символ — отдельный inline-block, а между двумя atomic inline
     браузеру разрешено переносить строку. Без обёртки «Minecraft» ломается на
     «Minec / raft», «подсистему» — на «подс / истему»: перенос идёт где попало,
     а не по пробелам. Обёртка с nowrap возвращает переносы только на пробелы.

     Пробелы оставляем обычными текстовыми узлами — они и есть точки переноса. */
  function split(el, mode) {
    const byWord = mode === 'words';
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType !== 3) continue;
      if (!node.nodeValue) continue;

      const frag = document.createDocumentFragment();
      for (const part of node.nodeValue.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); continue; }

        if (byWord) {
          // Слово само себе единица анимации: обёртка не нужна
          const span = document.createElement('span');
          span.className = 't-part';
          span.textContent = part;
          frag.appendChild(span);
          continue;
        }

        const word = document.createElement('span');
        word.className = 't-word';
        for (const ch of part) {
          const span = document.createElement('span');
          span.className = 't-part';
          span.textContent = ch;
          word.appendChild(span);
        }
        frag.appendChild(word);
      }
      el.replaceChild(frag, node);
    }
  }

  /* Идемпотентно: повторный вызов на уже разобранном элементе ничего не
     ломает, но заново раздаёт номера — после смены текста они другие. */
  function build(el) {
    // Буквы — только для коротких надписей (имя, шапка). В описании тысячи
    // символов, и это роняет кадры; там слова, их в разы меньше.
    const mode = el.hasAttribute('data-t-words') ? 'words' : 'chars';
    split(el, mode);
    el.classList.add('t-line-chars');

    const parts = el.querySelectorAll('.t-part');
    const step = Math.min(STEP_MAX, TOTAL_MAX / Math.max(1, parts.length));

    el.style.setProperty('--t-char-step', step.toFixed(2) + 'ms');
    el.style.setProperty('--t-char-dur', DUR + 'ms');
    parts.forEach((c, i) => c.style.setProperty('--i', i));
  }

  function attach(el) {
    build(el);

    /* Тексты описания приходят из Modrinth и переписываются через textContent —
       это childList. Свой разбор идёт через characterData внутри span, и его
       мы намеренно не слушаем, иначе наблюдатель зациклился бы на себе. */
    const obs = new MutationObserver(() => {
      obs.disconnect();
      build(el);
      obs.observe(el, { childList: true });
    });
    obs.observe(el, { childList: true });
    el.__revealObs = obs;
  }

  function init() {
    for (const el of document.querySelectorAll(TARGETS)) attach(el);
  }

  function refresh() {
    for (const el of document.querySelectorAll(TARGETS)) {
      if (!el.__revealObs) attach(el);
      else build(el);
    }
  }

  window.TextReveal = { refresh, build };

  if (!window.TEXT_REVEAL_TEST_MANUAL) {
    window.addEventListener('DOMContentLoaded', init);
  }
})();
