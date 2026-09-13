/* ── Переводы ─────────────────────────────────────────────────────────────────
   Весь текст интерфейса живёт здесь, в одном словаре на два языка. Ключи
   сгруппированы по месту, где строка встречается, чтобы её можно было найти
   не запуская лаунчер.

   Разметку переводит applyStatic(): элементы помечены атрибутом data-i18n
   (текст) или data-i18n-attr (подсказка, placeholder). Динамические строки
   в app.js берут перевод через t().

   Подстановка значений — {name} в тексте. Порядок слов в языках разный,
   поэтому склеивать строки из кусков нельзя: только целые фразы с метками.
*/

(function () {
  'use strict';

  const DICT = {
    ru: {
      // ── Общее ──────────────────────────────────────────────────────────────
      'app.name': 'vulkan launcher',
      'common.close': 'Закрыть',
      'common.cancel': 'Отмена',
      'common.save': 'Сохранить',
      'common.add': 'Добавить',
      'common.play': 'Играть',
      'common.next': 'Следующий',
      'common.prev': 'Предыдущий',
      'common.back': 'Назад',
      'common.skip': 'Пропустить',
      'common.continue': 'Продолжить',
      'common.later': 'Позже',
      'common.yes': 'Да',
      'common.no': 'Нет',
      'common.done': 'Готово',
      'common.loading': 'Загружаю…',

      // ── Заголовок окна ─────────────────────────────────────────────────────
      'title.minimize': 'Свернуть',
      'title.maximize': 'Развернуть',
      'title.close': 'Закрыть',
      'title.folder': 'Открыть папку',
      // Кнопка DIR ведёт в папку сборки — у каждой версии с загрузчиком своя.
      'folder.opened': 'Папка сборки: {path}',
      'folder.path': 'Папка сборки: {path}',

      // ── Сайдбар ────────────────────────────────────────────────────────────
      'nav.play': 'Play',
      'nav.mods': 'Mods',
      'nav.settings': 'Settings',
      'sidebar.profile': 'Профиль',
      'sidebar.versions': 'Версии',
      'sidebar.localProfile': 'локальный профиль',
      'sidebar.accounts': 'Управление аккаунтами',
      'sidebar.vanilla.profile': 'Профиль',
      'sidebar.vanilla.fixed': 'Фиксированная сборка',
      // Состояние версии в списке. Скачана — значит лежит на диске целиком,
      // и при запуске её качать уже не придётся.
      'ver.installed': 'скачана',
      'ver.notInstalled': 'не скачана, будет загружена при запуске',

      // ── Главная страница ───────────────────────────────────────────────────
      'hero.ready': 'Готов к запуску',
      'hero.title.pulse': 'Готов играть.',
      'hero.title.vanilla': 'Режим Vanilla.',
      'hero.text.pulse': 'клиент {name} на Fabric {version}, с отдельной маршрутизацией Vanilla и изолированным чистым профилем.',
      'hero.text.vanilla': 'Чистый профиль Minecraft с изолированными файлами, настоящими сборками загрузчиков и отдельными путями загрузки.',
      'hero.badge.vanilla': 'Профиль Vanilla готов',
      'hero.launch.pulse': 'ЗАПУСТИТЬ',
      'hero.launch.vanilla': 'ЗАПУСТИТЬ VANILLA',
      'hero.loaders': 'Доступные загрузчики',
      'hero.selectedVersion': 'выбранная версия',
      'hero.selectedLoader': 'выбранная сборка загрузчика',
      'hero.activeProfile': 'активный профиль',
      'hero.showLog': 'Показать журнал',

      // ── Музыка ─────────────────────────────────────────────────────────────
      'music.title': 'Фоновая музыка',
      'music.waiting': 'Жду треки…',
      'music.playlist': 'ПЛЕЙЛИСТ',
      'music.bytebeat': 'BYTEBEAT',
      'music.pause': 'Пауза',
      'music.play': 'Играть',
      'music.next': 'Следующий',
      'music.volume': 'Громкость',
      'music.crossfade': 'Кроссфейд готов — папка музыки создаётся сама',
      'music.openFolder': 'Открыть папку музыки',
      'music.notChosen': 'Не выбран',
      'music.settings': 'Настройки bytebeat',
      'music.spotify': 'Spotify',
      'music.setup': 'Настроить',

      // ── Bytebeat ───────────────────────────────────────────────────────────
      'bb.title': 'Настройки bytebeat',
      'bb.mode': 'Режим',
      'bb.mode.float': 'Floatbeat',
      'bb.mode.byte': 'Bytebeat (8-bit)',
      'bb.mode.signed': 'Signed Bytebeat',
      'bb.mode.func': 'Funcbeat',
      'bb.sampleRate': 'Частота дискретизации (Гц)',
      'bb.fft': 'Размер FFT',
      'bb.height': 'Высота визуализатора (px)',

      // ── Моды ───────────────────────────────────────────────────────────────
      'mods.title': 'Каталог модов',
      'mods.subtitle': 'Совместимость привязана к выбранной версии Minecraft и сборке загрузчика.',
      'mods.search': 'Поиск модов в каталоге',
      'mods.sourceHint': 'У CurseForge поиск принимает только одну группу за запрос — уйдёт первая выбранная',
      'mods.autoInstall': 'Ставить обязательные моды',
      'mods.speedUp': 'Ускорить игру',
      'mods.speedUpHint': 'Sodium, Lithium, FerriteCore и другие — кратный рост FPS',
      'mods.autoDisable': 'Отключить несовместимые',
      'mods.checkUpdates': 'Проверить обновления',
      'mods.catalog': 'Каталог',
      'mods.showMore': 'Показать ещё',
      'mods.loaderBuilds': 'Сборки загрузчика для выбранной версии',
      'mods.installed': 'Установленные и отключённые',
      'mods.library': 'Скачанные в библиотеку',
      'mods.catalogs': 'Мод-каталоги',
      'mods.cfKey': 'Ключ CurseForge',
      'mods.cfKeyHint': 'Без ключа CurseForge работает через публичный прокси api.curse.tools. Свой ключ (console.curseforge.com) переключает лаунчер на официальный API.',
      'mods.optional': 'необязательно',
      'mods.install': 'Установить',
      'mods.blocked': 'Недоступно',
      'mods.installing': 'Ставлю…',
      'mods.installedOk': 'Установлен',
      'mods.compatible': 'совместим',
      'mods.incompatible': 'несовместим',
      'mods.versions': 'Версии',
      'mods.noVersions': 'Для {version} / {loader} версий нет.',
      'mods.loadingVersions': 'Загружаю список версий…',
      'mods.download': 'Скачать',
      'mods.downloading': 'Качаю…',
      'mods.openModrinth': 'Открыть на Modrinth ↗',
      'mods.openCurseforge': 'Открыть на CurseForge ↗',
      'mods.selectMod': 'Выбери мод',
      'mods.detailStub': 'Совместимость и состояние появятся здесь.',
      'mods.noDescription': 'Описание недоступно.',
      'mods.toggle': 'Включить/выключить',
      'mods.restore': 'Откатить набор',
      'mods.notCompatible': '{name} несовместим с {version} / {loader}',

      // ── Настройки ──────────────────────────────────────────────────────────
      'settings.launch': 'Запуск',
      'settings.ram': 'Выделенная память',
      'settings.javaPath': 'Путь к Java',
      'settings.javaAuto': 'Определить самому',
      'settings.profiles': 'Профили',
      'settings.vanillaDefault': 'Версия Vanilla по умолчанию',
      'settings.vanillaNote': 'Vanilla работает из %appdata%/pulsePLUS/vanilla.',
      'settings.mods': 'Моды',
      'settings.autoUpdate': 'Обновлять моды автоматически',
      'settings.autoDisable': 'Отключать несовместимые моды',
      'settings.library': 'Показывать библиотеку скачанных модов',
      'settings.music': 'Музыка',
      'settings.musicEnable': 'Включить фоновую музыку',
      'settings.musicVolume': 'Громкость музыки',
      'settings.language': 'Язык',
      'settings.languageNote': 'Язык интерфейса и туториала.',
      'settings.save': 'Сохранить настройки',
      'settings.saved': 'Настройки сохранены',
      'settings.tutorial': 'Обучение',
      'settings.tutorialRun': 'Пройти обучение заново',
      'settings.tutorialNote': 'Короткий разбор того, что где находится.',

      // ── Аккаунты ───────────────────────────────────────────────────────────
      'acc.title': 'Аккаунты',
      'acc.subtitle': 'Выбери, под кем играть',
      'acc.newOffline': 'Новый офлайн-профиль',
      'acc.nick': 'Ник',
      'acc.nickHint': '3–16 символов: латиница, цифры, подчёркивание',
      'acc.msLogin': 'Вход Microsoft',
      'acc.save': 'Сохранить',
      'acc.saved': 'Клиент ID сохранён',
      'acc.enterNick': 'Впиши ник',
      'acc.clientId': 'Client ID приложения Azure',
      'acc.msHint': 'Публичный клиент Azure, секрет не нужен. В приложении должно быть включено «Allow public client flows».',
      'acc.playingAs': 'Играешь как {name}',

      // ── Spotify ────────────────────────────────────────────────────────────
      'sp.title': 'Плеер Spotify',
      'sp.subtitle': 'Открой плейлист прямо из лаунчера',
      'sp.feature1': 'Открывается в отдельном окне с полным плеером',
      'sp.feature2': 'Сессия сохраняется — войди один раз',
      'sp.feature3': 'Поддерживает плейлисты, альбомы и треки',
      'sp.link': 'Ссылка на Spotify',
      'sp.placeholder': 'Вставь ссылку на плейлист, альбом или трек Spotify',
      'sp.open': 'Открыть',
      'sp.opened': 'Плеер Spotify открыт',

      // ── Прощание ───────────────────────────────────────────────────────────
      'bye.title': 'до встречи',
      'bye.subtitle': 'закрываем лаунчер…',

      // ── Туториал ───────────────────────────────────────────────────────────
      'tut.welcomeTitle': 'Привет!',
      'tut.welcomeBody': 'Я покажу, что где лежит в лаунчере. Это займёт минуту. Сначала выбери язык — на нём будет и лаунчер, и обучение.',
      'tut.start': 'Начать обучение',
      'tut.notNow': 'Не сейчас',
      'tut.step': 'Шаг {n} из {total}',
      'tut.waiting': 'Жду тебя',
      'tut.resumeTitle': 'Продолжим?',
      'tut.resumeBody': 'Ты отошёл от шага «{step}». Продолжить с того же места или начать сначала?',
      'tut.resume': 'Продолжить',
      'tut.restart': 'Сначала',
      'tut.finishTitle': 'Основное позади',
      'tut.finishBody': 'Это был основной круг. Показать дополнительное — оптимизацию, музыку, аккаунты и тонкие настройки?',
      'tut.showExtra': 'Показать дополнительное',
      'tut.thatIsAll': 'На этом всё',
      'tut.extraDoneTitle': 'Всё, готово',
      'tut.extraDoneBody': 'Теперь ты знаешь лаунчер целиком. Обучение всегда можно запустить заново в настройках.',
      'tut.close': 'Закрыть обучение',

      // Фразы ожидания. Их пятнадцать, выбирается случайная — чтобы лаунчер
      // не повторял одно и то же, если игрок отвлёкся не в первый раз.
      'tut.wait.1': 'Ожидание…',
      'tut.wait.2': 'Ладно, я подожду.',
      'tut.wait.3': 'Не спеши, я здесь.',
      'tut.wait.4': 'Дай знать, когда будешь готов.',
      'tut.wait.5': 'Я никуда не ушёл.',
      'tut.wait.6': 'Осматривайся, я подожду.',
      'tut.wait.7': 'Всё в порядке, продолжаем когда скажешь.',
      'tut.wait.8': 'Спокойно, время есть.',
      'tut.wait.9': 'Жду. Тыкай куда хочется.',
      'tut.wait.10': 'Я тут, за углом.',
      'tut.wait.11': 'Отвлёкся? Ничего страшного.',
      'tut.wait.12': 'Свистни, когда вернёшься.',
      'tut.wait.13': 'Пока просто наблюдаю.',
      'tut.wait.14': 'Всё готово, ждём только тебя.',
      'tut.wait.15': 'Подожду, мне не к спеху.',

      // Шаги: vanilla
      'tut.s1.title': 'Переключатель режимов',
      'tut.s1.body': 'Здесь два профиля. Vanilla — чистый Minecraft без модов, он живёт в отдельной папке и ничего не трогает у чита. Нажми на кнопку Vanilla, чтобы посмотреть.',
      'tut.s2.title': 'Версии',
      'tut.s2.body': 'В режиме Vanilla в сайдбаре появляется список версий. Выбери любую — лаунчер скачает её сам при первом запуске.',
      'tut.s3.title': 'Запуск',
      'tut.s3.body': 'Главная кнопка. Она запускает игру с той версией и тем загрузчиком, что выбраны ниже.',
      'tut.s4.title': 'Что загружено',
      'tut.s4.body': 'Тут видно, какая версия, какой загрузчик и какой профиль сейчас активны. Если что-то не то — вернись на шаг назад.',
      'tut.s5.title': 'Каталог модов',
      'tut.s5.body': 'Открой вкладку Mods. Моды ставятся в тот профиль, который выбран сейчас.',
      'tut.s6.title': 'Откуда брать моды',
      'tut.s6.body': 'Modrinth и CurseForge. Списки одинаковые по виду, различаются только источники. Переключайся, если чего-то нет в одном.',
      'tut.s7.title': 'Группы модов',
      'tut.s7.body': 'Чипы отбирают моды по назначению: оптимизация, библиотеки, магия. Можно выбрать несколько сразу.',
      'tut.s8.title': 'Установка',
      'tut.s8.body': 'Кнопка «Установить» кладёт мод в папку выбранного профиля. Если мод несовместим с версией, кнопка скажет об этом.',
      'tut.s9.title': 'Описание мода',
      'tut.s9.body': 'Нажми на любую строку — справа откроется описание с картинками. Там же кнопка «Версии», если нужна не последняя.',
      'tut.s10.title': 'Установленные',
      'tut.s10.body': 'Ниже — то, что уже стоит. Мод можно выключить, не удаляя: лаунчер просто убирает его из сборки.',
      'tut.s11.title': 'Оптимизация',
      'tut.s11.body': 'Кнопка «Ускорить игру» ставит набор модов производительности — Sodium, Lithium и другие. На слабой машине разница заметна сразу.',
      'tut.s12.title': 'Настройки',
      'tut.s12.body': 'Открой вкладку Settings. Тут память, путь к Java и язык интерфейса.',
      'tut.s13.title': 'Память',
      'tut.s13.body': 'Сколько оперативной памяти отдать игре. Лаунчер подставил значение под твою машину и не даст выставить опасное.',
      'tut.s14.title': 'Язык',
      'tut.s14.body': 'Здесь язык можно поменять в любой момент — переведётся весь интерфейс.',
      'tut.s15.title': 'Аккаунты',
      'tut.s15.body': 'Кнопка внизу сайдбара. Можно играть офлайн под ником или войти через Microsoft — тогда скин и плащи подтянутся сами.',

      // Шаги: vulkan
      'tut.v1.title': 'Теперь профиль чита',
      'tut.v1.body': 'Переключись обратно на vulkan. Дальше отличия.',
      'tut.v2.title': 'Чем отличается',
      'tut.v2.body': 'Профиль vulkan держит свою сборку модов и свою версию. Он не пересекается с Vanilla: что поставил здесь, там не появится.',
      'tut.v3.title': 'Сборка зафиксирована',
      'tut.v3.body': 'В этом профиле версия и загрузчик закреплены, чтобы сборка не разъехалась после обновления лаунчера.',
      'tut.v4.title': 'Куда ставить моды',
      'tut.v4.body': 'Всё, что поставишь во вкладке Mods, уйдёт в профиль, который активен. Переключай режим — и увидишь, что списки разные.',

      // Шаги: дополнительное
      'tut.e1.title': 'Музыка',
      'tut.e1.body': 'Встроенный плеер: кладёшь mp3 в папку — лаунчер подхватит. Есть и генеративная музыка, если файлов нет.',
      'tut.e2.title': 'Bytebeat',
      'tut.e2.body': 'Режим генеративной музыки: трек считается формулой прямо на лету. Формулы можно писать свои.',
      'tut.e3.title': 'Spotify',
      'tut.e3.body': 'Открывает плейлист в отдельном окне лаунчера. Сессия сохраняется, входить нужно один раз.',
      'tut.e4.title': 'Откат сборки',
      'tut.e4.body': 'Кнопка отката возвращает набор модов к прошлому состоянию — если что-то поставил и не понравилось.',
      'tut.e5.title': 'Обновления модов',
      'tut.e5.body': 'Лаунчер умеет проверять, вышли ли новые версии установленных модов, и обновлять их.',
      'tut.e6.title': 'Логи',
      'tut.e6.body': 'Если игра не запустилась — кнопка журнала покажет, на чём именно споткнулась.'
    },

    en: {
      'app.name': 'vulkan launcher',
      'common.close': 'Close',
      'common.cancel': 'Cancel',
      'common.save': 'Save',
      'common.add': 'Add',
      'common.play': 'Play',
      'common.next': 'Next',
      'common.prev': 'Previous',
      'common.back': 'Back',
      'common.skip': 'Skip',
      'common.continue': 'Continue',
      'common.later': 'Later',
      'common.yes': 'Yes',
      'common.no': 'No',
      'common.done': 'Done',
      'common.loading': 'Loading…',

      'title.minimize': 'Minimize',
      'title.maximize': 'Maximize',
      'title.close': 'Close',
      'title.folder': 'Open folder',
      'folder.opened': 'Instance folder: {path}',
      'folder.path': 'Instance folder: {path}',

      'nav.play': 'Play',
      'nav.mods': 'Mods',
      'nav.settings': 'Settings',
      'sidebar.profile': 'Profile',
      'sidebar.versions': 'Versions',
      'sidebar.localProfile': 'local profile',
      'sidebar.accounts': 'Manage accounts',
      'sidebar.vanilla.profile': 'Profile',
      'sidebar.vanilla.fixed': 'Locked build',
      'ver.installed': 'downloaded',
      'ver.notInstalled': 'not downloaded yet, will be fetched on launch',

      'hero.ready': 'Ready to play',
      'hero.title.pulse': 'Ready to play.',
      'hero.title.vanilla': 'Vanilla mode.',
      'hero.text.pulse': '{name} client on Fabric {version}, with separate Vanilla routing and an isolated clean profile.',
      'hero.text.vanilla': 'Pure Minecraft profile with isolated clean files, real loader builds and separate download paths.',
      'hero.badge.vanilla': 'Vanilla profile ready',
      'hero.launch.pulse': 'LAUNCH',
      'hero.launch.vanilla': 'LAUNCH VANILLA',
      'hero.loaders': 'Available loaders',
      'hero.selectedVersion': 'selected version',
      'hero.selectedLoader': 'selected loader build',
      'hero.activeProfile': 'active profile',
      'hero.showLog': 'Show log',

      'music.title': 'Background music',
      'music.waiting': 'Waiting for tracks…',
      'music.playlist': 'PLAYLIST',
      'music.bytebeat': 'BYTEBEAT',
      'music.pause': 'Pause',
      'music.play': 'Play',
      'music.next': 'Next',
      'music.volume': 'Volume',
      'music.crossfade': 'Crossfade ready — music folder is created for you',
      'music.openFolder': 'Open music folder',
      'music.notChosen': 'Nothing selected',
      'music.settings': 'Bytebeat settings',
      'music.spotify': 'Spotify',
      'music.setup': 'Set up',

      'bb.title': 'Bytebeat settings',
      'bb.mode': 'Mode',
      'bb.mode.float': 'Floatbeat',
      'bb.mode.byte': 'Bytebeat (8-bit)',
      'bb.mode.signed': 'Signed Bytebeat',
      'bb.mode.func': 'Funcbeat',
      'bb.sampleRate': 'Sample rate (Hz)',
      'bb.fft': 'FFT size',
      'bb.height': 'Visualizer height (px)',

      'mods.title': 'Mod browser',
      'mods.subtitle': 'Compatibility is tied to the selected Minecraft version and loader build.',
      'mods.search': 'Search mods in the catalog',
      'mods.sourceHint': 'CurseForge search accepts only one category per request — the first one selected will be used',
      'mods.autoInstall': 'Install required mods',
      'mods.speedUp': 'Speed up the game',
      'mods.speedUpHint': 'Sodium, Lithium, FerriteCore and others — a multiple FPS gain',
      'mods.autoDisable': 'Disable incompatible',
      'mods.checkUpdates': 'Check for updates',
      'mods.catalog': 'Catalog',
      'mods.showMore': 'Show more',
      'mods.loaderBuilds': 'Loader builds for the selected version',
      'mods.installed': 'Installed and disabled',
      'mods.library': 'Downloaded library',
      'mods.catalogs': 'Mod catalogs',
      'mods.cfKey': 'CurseForge key',
      'mods.cfKeyHint': 'Without a key CurseForge goes through the public api.curse.tools proxy. Your own key (console.curseforge.com) switches the launcher to the official API.',
      'mods.optional': 'optional',
      'mods.install': 'Install',
      'mods.blocked': 'Blocked',
      'mods.installing': 'Installing…',
      'mods.installedOk': 'Installed',
      'mods.compatible': 'compatible',
      'mods.incompatible': 'not compatible',
      'mods.versions': 'Versions',
      'mods.noVersions': 'No versions for {version} / {loader}.',
      'mods.loadingVersions': 'Loading versions…',
      'mods.download': 'Download',
      'mods.downloading': 'Downloading…',
      'mods.openModrinth': 'Open on Modrinth ↗',
      'mods.openCurseforge': 'Open on CurseForge ↗',
      'mods.selectMod': 'Select a mod',
      'mods.detailStub': 'Compatibility and state will appear here.',
      'mods.noDescription': 'No description available.',
      'mods.toggle': 'Toggle',
      'mods.restore': 'Restore snapshot',
      'mods.notCompatible': '{name} is not compatible with {version} / {loader}',

      'settings.launch': 'Launch',
      'settings.ram': 'RAM allocation',
      'settings.javaPath': 'Java path',
      'settings.javaAuto': 'Auto-detect',
      'settings.profiles': 'Profiles',
      'settings.vanillaDefault': 'Vanilla default version',
      'settings.vanillaNote': 'Vanilla runs from %appdata%/pulsePLUS/vanilla.',
      'settings.mods': 'Mods',
      'settings.autoUpdate': 'Auto-update mods',
      'settings.autoDisable': 'Auto-disable incompatible mods',
      'settings.library': 'Show downloaded mods library',
      'settings.music': 'Music',
      'settings.musicEnable': 'Enable background music',
      'settings.musicVolume': 'Music volume',
      'settings.language': 'Language',
      'settings.languageNote': 'Language of the interface and the tutorial.',
      'settings.save': 'Save settings',
      'settings.saved': 'Settings saved',
      'settings.tutorial': 'Tutorial',
      'settings.tutorialRun': 'Run the tutorial again',
      'settings.tutorialNote': 'A short walk through what is where.',

      'acc.title': 'Accounts',
      'acc.subtitle': 'Choose who to play as',
      'acc.newOffline': 'New offline profile',
      'acc.nick': 'Nickname',
      'acc.nickHint': '3–16 characters: latin letters, digits, underscore',
      'acc.msLogin': 'Sign in with Microsoft',
      'acc.save': 'Save',
      'acc.saved': 'Client ID saved',
      'acc.enterNick': 'Enter a nickname',
      'acc.clientId': 'Azure application Client ID',
      'acc.msHint': 'Public Azure client, no secret needed. The app must have "Allow public client flows" enabled.',
      'acc.playingAs': 'Playing as {name}',

      'sp.title': 'Spotify player',
      'sp.subtitle': 'Open a playlist right from the launcher',
      'sp.feature1': 'Opens in a separate window with the full player',
      'sp.feature2': 'The session is kept — sign in once',
      'sp.feature3': 'Supports playlists, albums and tracks',
      'sp.link': 'Spotify link',
      'sp.placeholder': 'Paste a Spotify playlist, album or track link',
      'sp.open': 'Open',
      'sp.opened': 'Spotify player opened',

      'bye.title': 'see you',
      'bye.subtitle': 'shutting down…',

      'tut.welcomeTitle': 'Hi there!',
      'tut.welcomeBody': 'Let me show you around the launcher. It takes a minute. First pick a language — it applies to both the launcher and the tour.',
      'tut.start': 'Start the tour',
      'tut.notNow': 'Not now',
      'tut.step': 'Step {n} of {total}',
      'tut.waiting': 'Waiting for you',
      'tut.resumeTitle': 'Carry on?',
      'tut.resumeBody': 'You stepped away from "{step}". Continue where you left off, or start over?',
      'tut.resume': 'Continue',
      'tut.restart': 'Start over',
      'tut.finishTitle': 'That is the basics',
      'tut.finishBody': 'That was the main tour. Want to see the extras — performance, music, accounts and the finer settings?',
      'tut.showExtra': 'Show the extras',
      'tut.thatIsAll': 'That is all',
      'tut.extraDoneTitle': 'All done',
      'tut.extraDoneBody': 'Now you know the launcher inside out. You can run the tour again any time from Settings.',
      'tut.close': 'Close the tour',

      'tut.wait.1': 'Waiting…',
      'tut.wait.2': 'All right, I will wait.',
      'tut.wait.3': 'No rush, I am here.',
      'tut.wait.4': 'Let me know when you are ready.',
      'tut.wait.5': 'I am not going anywhere.',
      'tut.wait.6': 'Have a look around, I will wait.',
      'tut.wait.7': 'All good, we continue whenever you say.',
      'tut.wait.8': 'Take your time.',
      'tut.wait.9': 'Waiting. Click whatever you like.',
      'tut.wait.10': 'I am just around the corner.',
      'tut.wait.11': 'Got distracted? That is fine.',
      'tut.wait.12': 'Give me a shout when you are back.',
      'tut.wait.13': 'Just watching for now.',
      'tut.wait.14': 'Everything is ready, only you are missing.',
      'tut.wait.15': 'I will wait, no hurry at all.',

      'tut.s1.title': 'Mode switch',
      'tut.s1.body': 'There are two profiles here. Vanilla is plain Minecraft with no mods — it lives in its own folder and never touches the modded one. Click Vanilla to take a look.',
      'tut.s2.title': 'Versions',
      'tut.s2.body': 'In Vanilla mode a version list appears in the sidebar. Pick any — the launcher downloads it on first launch.',
      'tut.s3.title': 'Launch',
      'tut.s3.body': 'The main button. It starts the game with the version and loader selected below.',
      'tut.s4.title': 'What is loaded',
      'tut.s4.body': 'This shows the active version, loader and profile. If something looks wrong, go a step back.',
      'tut.s5.title': 'Mod catalog',
      'tut.s5.body': 'Open the Mods tab. Mods go into whichever profile is active right now.',
      'tut.s6.title': 'Where mods come from',
      'tut.s6.body': 'Modrinth and CurseForge. The lists look the same, only the source differs. Switch if something is missing on one.',
      'tut.s7.title': 'Mod groups',
      'tut.s7.body': 'The chips filter mods by purpose: performance, libraries, magic. You can pick several at once.',
      'tut.s8.title': 'Installing',
      'tut.s8.body': 'The Install button puts the mod into the active profile folder. If it does not fit the version, the button says so.',
      'tut.s9.title': 'Mod description',
      'tut.s9.body': 'Click any row — a description with images opens on the right. The Versions button is there too, if you need an older build.',
      'tut.s10.title': 'Installed mods',
      'tut.s10.body': 'Below are the ones you already have. A mod can be switched off without deleting it — the launcher just drops it from the build.',
      'tut.s11.title': 'Performance',
      'tut.s11.body': 'The "Speed up the game" button installs a set of performance mods — Sodium, Lithium and others. On a weak machine the difference shows at once.',
      'tut.s12.title': 'Settings',
      'tut.s12.body': 'Open the Settings tab. Memory, the Java path and the interface language live here.',
      'tut.s13.title': 'Memory',
      'tut.s13.body': 'How much RAM to give the game. The launcher picked a value for your machine and will not let you set a dangerous one.',
      'tut.s14.title': 'Language',
      'tut.s14.body': 'The language can be changed any time — the whole interface follows.',
      'tut.s15.title': 'Accounts',
      'tut.s15.body': 'The button at the bottom of the sidebar. Play offline under a nickname, or sign in with Microsoft so your skin and capes come along.',

      'tut.v1.title': 'Now the modded profile',
      'tut.v1.body': 'Switch back to vulkan. Here come the differences.',
      'tut.v2.title': 'How it differs',
      'tut.v2.body': 'The vulkan profile keeps its own mod set and its own version. It never shares with Vanilla: what you install here does not appear there.',
      'tut.v3.title': 'The build is locked',
      'tut.v3.body': 'In this profile the version and loader are pinned, so the build does not drift apart after a launcher update.',
      'tut.v4.title': 'Where mods go',
      'tut.v4.body': 'Anything you install in the Mods tab goes into the active profile. Switch modes and you will see the lists differ.',

      'tut.e1.title': 'Music',
      'tut.e1.body': 'A built-in player: drop mp3 files into the folder and the launcher picks them up. There is generative music too, if you have no files.',
      'tut.e2.title': 'Bytebeat',
      'tut.e2.body': 'Generative music mode: the track is computed from a formula on the fly. You can write your own formulas.',
      'tut.e3.title': 'Spotify',
      'tut.e3.body': 'Opens a playlist in a separate launcher window. The session is kept, so you sign in once.',
      'tut.e4.title': 'Restoring a build',
      'tut.e4.body': 'The restore button brings the mod set back to its previous state — handy if you installed something you did not like.',
      'tut.e5.title': 'Mod updates',
      'tut.e5.body': 'The launcher can check whether newer versions of your installed mods exist and update them.',
      'tut.e6.title': 'Logs',
      'tut.e6.body': 'If the game did not start, the log button shows exactly where it tripped.'
    }
  };

  const LANGS = [
    { code: 'ru', label: 'Русский' },
    { code: 'en', label: 'English' }
  ];

  let lang = 'ru';

  /* Подстановка {name}: порядок слов в языках разный, поэтому склеивать
     строки из кусков нельзя — только целые фразы с метками. */
  function format(text, vars) {
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (all, key) =>
      (vars[key] === undefined ? all : String(vars[key])));
  }

  function t(key, vars) {
    const table = DICT[lang] || DICT.ru;
    const text = table[key] !== undefined ? table[key] : (DICT.ru[key] !== undefined ? DICT.ru[key] : key);
    return format(text, vars);
  }

  /* Перевод разметки. data-i18n — текст элемента, data-i18n-attr — атрибуты
     вида "placeholder:mods.search;title:title.close". */
  function applyStatic(root) {
    const scope = root || document;
    for (const el of scope.querySelectorAll('[data-i18n]')) {
      el.textContent = t(el.dataset.i18n);
    }
    for (const el of scope.querySelectorAll('[data-i18n-attr]')) {
      for (const pair of el.dataset.i18nAttr.split(';')) {
        const [attr, key] = pair.split(':').map((s) => s && s.trim());
        if (attr && key) el.setAttribute(attr, t(key));
      }
    }
    document.documentElement.lang = lang;
  }

  const listeners = [];

  function setLang(code, options) {
    if (code !== 'ru' && code !== 'en') return;
    const changed = code !== lang;
    lang = code;
    applyStatic();
    if (!options || options.notify !== false) {
      for (const fn of listeners) {
        try { fn(lang); } catch (error) { console.warn('[i18n] слушатель упал:', error.message); }
      }
    }
    return changed;
  }

  window.I18N = {
    t,
    setLang,
    applyStatic,
    langs: LANGS,
    get lang() { return lang; },
    onChange(fn) { listeners.push(fn); }
  };
  // Короткий псевдоним: в app.js он встречается сотни раз
  window.t = t;
})();
