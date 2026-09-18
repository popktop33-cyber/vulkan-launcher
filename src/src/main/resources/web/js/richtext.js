/* ── Разбор описания мода ─────────────────────────────────────────────────────
   Текст приходит снаружи: у Modrinth это markdown, у CurseForge — готовый HTML.
   Показывать его через innerHTML нельзя ни в каком виде — это чужой документ,
   и один <script> внутри описания выполнялся бы с правами лаунчера.

   Поэтому здесь всё строится узлами DOM, а не строками разметки. Текст по
   умолчанию экранирован: чтобы получить тег, его надо явно собрать в коде.
   Единственное, что проходит насквозь, — ссылки на картинки, и только если
   это http или https.

   Картинки — то, ради чего этот файл и появился: в описаниях модов их бывает
   по пять-шесть штук, и раньше они просто пропадали.
*/

(function () {
  'use strict';

  const MAX_IMAGES = 12;   // дальше это уже галерея, а не описание мода

  /* Блоки короче этого помечаем data-t-words — их разберёт на слова
     js/text-reveal.js и покажет волной.

     По буквам здесь нельзя. Замерено на чистой странице: текст в 968 символов,
     разобранный на буквы, роняет 40% кадров (92 кадра за 1.5 с против 53), а
     тот же текст из 164 слов идёт ровно как пустая страница — 91 кадр. Дело не
     в размытии: снять фильтр дало лишь 56 -> 61 кадр, дорого само число
     анимированных элементов. Буквы остались только у имени и шапки, где их
     десятки, а не тысячи. */
  const WORD_LIMIT = 600;

  /* Перевод строки, которые этот файл рисует сам. Словарь грузится раньше
     (i18n.js идёт первым тегом), но обращаться к t() напрямую нельзя: без
     словаря файл упал бы на ReferenceError. Тот же приём, что в skins.js. */
  function tr(key, fallback) {
    const value = typeof t === 'function' ? t(key) : null;
    return value && value !== key ? value : fallback;
  }

  /* Пропускаем только http и https. javascript:, data: и file: — мимо:
     первая выполнится при клике, вторая может нести произвольные данные. */
  function safeUrl(raw) {
    if (!raw) return null;
    const url = String(raw).trim().replace(/^<|>$/g, '');
    if (!/^https?:\/\//i.test(url)) return null;
    return url;
  }

  function unescapeEntities(text) {
    return text
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&apos;/gi, "'")
      .replace(/&mdash;/gi, '—')
      .replace(/&ndash;/gi, '–')
      .replace(/&amp;/gi, '&');   // последним, иначе раскурочит остальные
  }

  /* ── Первый проход: вынуть картинки и ссылки ────────────────────────────────
     До того как снимать теги, иначе <img> исчезнет вместе с остальной
     разметкой, а markdown-картинка превратится в мусор из скобок. */
  function extract(text, format) {
    const images = [];
    const links = [];

    let out = text.replace(/<img\b[^>]*>/gi, (tag) => {
      const src = /\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
      const url = safeUrl(src && (src[2] || src[3] || src[4]));
      if (!url || images.length >= MAX_IMAGES) return '';
      images.push(url);
      return '\u0000I' + (images.length - 1) + '\u0000';
    });

    if (format === 'markdown') {
      out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (all, alt, url) => {
        const safe = safeUrl(url);
        if (!safe || images.length >= MAX_IMAGES) return alt ? '' : '';
        images.push(safe);
        return '\u0000I' + (images.length - 1) + '\u0000';
      });
    }

    // Ссылки: сначала html-вид, потом markdown-вид.
    //
    // Метку ссылки НЕ разрешаем здесь, а храним и отдаём в inline(). Причина:
    // внутри <a> часто лежит картинка — так устроены badges (Modrinth,
    // CurseForge, лицензия). К этому моменту картинка уже заменена токеном, и
    // если просто вычистить теги, токен останется текстом метки и на экране
    // появится «I0». inline() развернёт его как обычный текст.
    out = out.replace(/<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi,
      (all, _q, d, s, b, label) => {
        const url = safeUrl(d || s || b);
        const text = label.replace(/<[^>]*>/g, '').trim();
        if (!url) return text;
        links.push({ url, label: text || url });
        return '\u0000L' + (links.length - 1) + '\u0000';
      });

    if (format === 'markdown') {
      out = out.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (all, label, url) => {
        const safe = safeUrl(url);
        if (!safe) return label;
        links.push({ url: safe, label });
        return '\u0000L' + (links.length - 1) + '\u0000';
      });
    }

    return { text: out, images, links };
  }

  /* ── Снять разметку ─────────────────────────────────────────────────────────
     Блочные теги превращаем в переводы строк, чтобы абзацы не слиплись,
     остальные просто убираем.

     В html-режиме снимаем всё подряд: там настоящий html-документ. В markdown
     так нельзя — «меньше < 5» превратилось бы в «меньше»: угловая скобка в
     тексте ничем не отличается от начала тега. Поэтому в markdown снимаем
     только известные теги, которых в описаниях Modrinth хватает. */
  const KNOWN_TAGS = /<\/?(?:p|div|br|hr|h[1-6]|ul|ol|li|blockquote|pre|code|center|span|strong|em|b|i|u|s|small|big|font|table|thead|tbody|tr|td|th|details|summary|sub|sup)\b[^>]*>/gi;

  function stripTags(text, htmlMode) {
    let out = text
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\s*\/\s*(p|div|h[1-6]|li|tr|blockquote|pre|details)\s*>/gi, '\n\n')
      .replace(/<\s*hr\s*\/?\s*>/gi, '\n\n');
    out = htmlMode ? out.replace(/<[^>]*>/g, '') : out.replace(KNOWN_TAGS, '');
    return out
      .replace(/\r\n?/g, '\n')
      .replace(/\n{3,}/g, '\n\n');
  }

  /* ── Строчная разметка ──────────────────────────────────────────────────────
     Возвращает узлы. Текст экранировать не нужно: он не попадает в разметку,
     а становится текстовым узлом. */
  function inline(text, images, links, depth) {
    const frag = document.createDocumentFragment();
    // Порядок веток = приоритет: **жирный** должен проверяться раньше *курсива*
    const re = /(\*\*|__)([\s\S]+?)\1|(\*|_)([\s\S]+?)\3|`([^`]+?)`|\u0000I(\d+)\u0000|\u0000L(\d+)\u0000/g;

    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));

      if (m[2] !== undefined) {
        const b = document.createElement('strong');
        b.appendChild(document.createTextNode(m[2]));
        frag.appendChild(b);
      } else if (m[4] !== undefined) {
        const i = document.createElement('em');
        i.appendChild(document.createTextNode(m[4]));
        frag.appendChild(i);
      } else if (m[5] !== undefined) {
        const c = document.createElement('code');
        c.appendChild(document.createTextNode(m[5]));
        frag.appendChild(c);
      } else if (m[6] !== undefined) {
        const url = images[Number(m[6])];
        if (url) {
          const img = document.createElement('img');
          img.className = 'detail-img';
          img.src = url;
          img.alt = '';
          img.loading = 'lazy';
          // Декодируем вне главного потока: без этого большая картинка
          // подвисает кадром ровно в момент появления в панели
          img.decoding = 'async';
          img.referrerPolicy = 'no-referrer';
          frag.appendChild(img);
        }
      } else if (m[7] !== undefined) {
        const link = links[Number(m[7])];
        if (link) {
          const a = document.createElement('a');
          a.className = 'detail-link';
          a.href = link.url;
          a.target = '_blank';
          a.rel = 'noreferrer';
          /* Метка ссылки разбирается тем же кодом: внутри <a> часто лежит
             картинка-бейдж, и без этого на её месте остался бы токен.
             Глубже одного уровня не идём — вложенных ссылок не бывает, а
             защита от зацикливания нужна. */
          if (depth) a.appendChild(document.createTextNode(link.label));
          else a.appendChild(inline(link.label, images, links, 1));
          frag.appendChild(a);
        }
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    return frag;
  }

  /* Помечаем короткий блок для буквенной волны (см. js/text-reveal.js).
     Считаем по тексту без разметки: она уже снята на этом шаге. */
  function markIfShort(el, text) {
    if (text.length <= WORD_LIMIT) el.setAttribute('data-t-words', '');
  }

  function renderInto(container, raw, format) {
    container.textContent = '';
    if (!raw || !raw.trim()) {
      container.appendChild(document.createTextNode(tr('mods.noDescription', 'Описание недоступно.')));
      return container;
    }

    const { text, images, links } = extract(String(raw), format === 'html' ? 'html' : 'markdown');
    // Сущности разворачиваем в обоих режимах: и в markdown-описаниях хватает
    // &amp; и &quot;, которые иначе так и висят в тексте.
    const body = unescapeEntities(stripTags(text, format === 'html'));

    // Блоки разделяем по пустым строкам, строки внутри блока — по одной
    const blocks = body.split(/\n{2,}/);
    let list = null;

    /* Строка, в которой нет ничего, кроме картинок. Такие подряд идущие строки
       собираем в один абзац: бейджи Modrinth/CurseForge/GitHub в описаниях
       стоят столбиком по одному на строку, и врозь они превращаются в
       вертикальный список огромных плашек вместо одного ряда иконок.

       Бейдж — это <a> с картинкой внутри, поэтому одной проверки на токен
       картинки мало: ссылку считаем медиа только тогда, когда её метка сама
       состоит из картинок. Текстовая ссылка на своей строке — обычный абзац. */
    const TOKEN_ONLY = /^(?:\u0000[IL]\d+\u0000\s*)+$/;
    const IMAGE_ONLY = /^(?:\u0000I\d+\u0000\s*)+$/;

    function isMediaLine(line) {
      if (!TOKEN_ONLY.test(line)) return false;
      let hasImage = false;
      const scan = /\u0000([IL])(\d+)\u0000/g;
      let hit;
      while ((hit = scan.exec(line)) !== null) {
        if (hit[1] === 'I') { hasImage = true; continue; }
        const link = links[Number(hit[2])];
        const label = link ? String(link.label).trim() : '';
        if (!label) continue;
        if (!IMAGE_ONLY.test(label)) return false;
        hasImage = true;
      }
      return hasImage;
    }

    let mediaHost = null;

    const flushMedia = () => { mediaHost = null; };

    for (const block of blocks) {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      if (!lines.length) continue;
      list = null;
      flushMedia();

      for (const line of lines) {
        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        const bullet = /^[-*+]\s+(.*)$/.exec(line);
        const ordered = /^\d+[.)]\s+(.*)$/.exec(line);
        const quote = /^>\s?(.*)$/.exec(line);

        if (!heading && !bullet && !ordered && !quote && isMediaLine(line)) {
          if (!mediaHost) {
            mediaHost = document.createElement('p');
            mediaHost.className = 'detail-p detail-media';
            container.appendChild(mediaHost);
          }
          mediaHost.appendChild(inline(line, images, links));
          continue;
        }
        flushMedia();

        if (heading) {
          // В панели нет места для h1–h6 заголовков: всё сводим к одному уровню
          const h = document.createElement('div');
          h.className = 'detail-h';
          h.appendChild(inline(heading[2], images, links));
          markIfShort(h, heading[2]);
          container.appendChild(h);
          list = null;
        } else if (bullet || ordered) {
          const tag = bullet ? 'ul' : 'ol';
          if (!list || list.tagName.toLowerCase() !== tag) {
            list = document.createElement(tag);
            list.className = 'detail-list';
            container.appendChild(list);
          }
          const li = document.createElement('li');
          li.appendChild(inline((bullet || ordered)[1], images, links));
          list.appendChild(li);
        } else if (quote) {
          const q = document.createElement('blockquote');
          q.className = 'detail-quote';
          q.appendChild(inline(quote[1], images, links));
          container.appendChild(q);
          list = null;
        } else {
          const p = document.createElement('p');
          p.className = 'detail-p';
          p.appendChild(inline(line, images, links));
          markIfShort(p, line);
          container.appendChild(p);
          list = null;
        }
      }
    }
    return container;
  }

  window.RichText = { renderInto };
})();
