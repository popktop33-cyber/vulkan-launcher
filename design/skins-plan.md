# Скины по никнейму — план реализации

> **Для агента:** обязательный под-скил — `superpowers:subagent-driven-development`
> (рекомендуется) либо `superpowers:executing-plans`. Шаги отмечены `- [ ]`.

**Цель:** лаунчер сам подтягивает скин и плащ по никнейму активного аккаунта и
показывает их в голове сайдбара, в списке аккаунтов и на Стиве в диораме.

**Подход:** сеть и кэш — в Java-бэкенде (`SkinService`), браузер берёт картинку с
`127.0.0.1`. Спецификация и доказательства — `design/skins.md`.

**Стек:** Java 17 (`javac --release 17`), gson 2.10.1, `com.sun.net.httpserver`,
фронтенд без сборщика (обычные ES-модули в браузере).

## Общие ограничения

- Компиляция: `./build.sh`, `javac --release 17 -cp src/lib/gson-2.10.1.jar`.
  Тестового фреймворка в проекте нет — проверка идёт классами-зондами в
  `build/scratch/` с `main`, как `LoaderCheck.java` и `AdoptCheck.java`.
- **Рабочей копии нет git.** Шагов «commit» в этом плане нет намеренно: вместо них
  живая проверка.
- **Живой лаунчер пользователя работает на порту 47820 — не трогать его.** Прогоны
  идут на отдельном порту (`47910`) и с подменённым `APPDATA`.
- **Всё, что пишет в папку данных, гонять только с подменённым `APPDATA`** —
  правило из `CLAUDE.md`. `LauncherConfig.dataDir()` читает `System.getenv("APPDATA")`,
  поэтому подмена работает.
- Комментарии по-русски и объясняют **почему**. Тексты для игрока — через
  `i18n.js`, RU и EN оба обязательны.
- Ник из URL валидируется `[A-Za-z0-9_]{1,16}` — он идёт в имя файла кэша.

## Структура файлов

| Файл | Ответственность |
|---|---|
| `src/src/main/java/launcher/skin/SkinService.java` (новый) | единственное место, знающее про Mojang, ely.by, mc-heads, minotar; кэш на диске |
| `src/src/main/java/launcher/web/WebServer.java` (правка) | эндпоинт `/api/skin/{ник}[/cape]` |
| `src/src/main/resources/web/js/app.js` (правка) | голова вместо буквы в сайдбаре и в списке аккаунтов |
| `src/src/main/resources/web/js/scene.js` (правка) | текстура Стива и коробка плаща |
| `build/scratch/SkinCheck.java` (новый) | зонд: сеть, кэш, отрицательный кэш |

---

### Задача 1: `SkinService` — ник в файл скина

**Файлы:**
- Создать: `src/src/main/java/launcher/skin/SkinService.java`
- Создать: `build/scratch/SkinCheck.java`

**Интерфейсы:**
- Использует: `LauncherConfig.dataDir()` → `%APPDATA%/pulsePLUS`
- Отдаёт наружу: `SkinService.skin(String nick) -> Path|null`,
  `SkinService.cape(String nick) -> Path|null`, `SkinService.skinsDir() -> Path`

- [ ] **Шаг 1: написать падающий зонд**

```java
// build/scratch/SkinCheck.java
import launcher.skin.SkinService;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.nio.file.*;

public class SkinCheck {
    static int bad = 0;
    static void ok(boolean cond, String what) {
        System.out.println((cond ? "  ок      " : "  ПРОВАЛ  ") + what);
        if (!cond) bad++;
    }
    public static void main(String[] a) throws Exception {
        Path s = SkinService.skin("herkulessi");
        ok(s != null && Files.exists(s), "скин herkulessi есть на диске: " + s);
        if (s != null && Files.exists(s)) {
            BufferedImage im = ImageIO.read(s.toFile());
            ok(im != null && im.getWidth() == 64,
               "это PNG шириной 64: " + (im == null ? "не PNG" : im.getWidth() + "x" + im.getHeight()));
        }
        System.out.println(bad == 0 ? "\nВСЁ ПРОШЛО" : "\nПРОВАЛОВ: " + bad);
        System.exit(bad == 0 ? 0 : 1);
    }
}
```

- [ ] **Шаг 2: убедиться, что зонд падает**

```bash
cd build/scratch
javac -encoding UTF-8 -cp "/path/to/pulsePLUS-workspace/src/lib/gson-2.10.1.jar" \
      -d . SkinCheck.java
```
Ожидается: ошибка компиляции `package launcher.skin does not exist`.

- [ ] **Шаг 3: написать `SkinService`**

```java
package launcher.skin;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import launcher.LauncherConfig;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;

/**
 * Скин и плащ игрока по никнейму — без входа в аккаунт.
 *
 * Первым идёт Mojang: только он отдаёт и правильный скин, и плащ. mc-heads и
 * minotar сигнала «ник не найден» не дают вовсе — на несуществующий ник они
 * возвращают дефолтного Стива с кодом 200 (проверено: файл байт в байт совпадает
 * с ответом на заведомо мусорный ник). Поэтому их спрашиваем только когда
 * предыдущие упали с ошибкой, и никогда — когда те честно ответили «нет такого»:
 * иначе вместо дефолтного Стива приедет чужой скин, а это хуже, потому что
 * снаружи неотличимо от правильного.
 *
 * Второй источник — ely.by: это другая система аккаунтов, ника у Mojang может
 * не быть, а на ely.by он есть. Чистый «нет» у Mojang — не повод остановиться.
 */
public final class SkinService {

    private SkinService() {}

    private static final long TTL_HIT  = 24 * 60 * 60 * 1000L;  // скин есть — сутки
    private static final long TTL_MISS = 60 * 60 * 1000L;       // скина нет — час
    private static final int  TIMEOUT  = 8000;

    /** Что нашлось. Пустой skinUrl означает «ник не зарегистрирован нигде». */
    private static final class Found {
        String uuid = "", skinUrl = "", capeUrl = "", source = "";
        boolean isEmpty() { return skinUrl.isEmpty(); }
    }

    public static Path skinsDir() {
        return LauncherConfig.dataDir().resolve("skins");
    }

    /** Файл скина на диске, либо null если скина нет. */
    public static Path skin(String nick) { return resolve(nick, false); }

    /** Файл плаща на диске, либо null если плаща нет. */
    public static Path cape(String nick) { return resolve(nick, true); }

    /**
     * Ник идёт в имя файла кэша, поэтому пропускаем только буквы, цифры и
     * подчёркивание. Без этой проверки через «../» в URL можно выписать файл
     * за пределы папки кэша.
     */
    public static boolean validNick(String nick) {
        return nick != null && nick.matches("[A-Za-z0-9_]{1,16}");
    }

    // Остальные методы — ниже, продолжение того же класса.
```

**Что писать уже на этом шаге.** `resolve` зовёт `lookup`, `http`, `download` и
`mojangUuid`/`mojangTextures` — без них класс не скомпилируется. Поэтому из шага 3
задачи 2 сюда сразу переезжают `http`, `download`, `mojangUuid`, `mojangTextures`
и `networkFailed`, а `lookup` пока содержит **только ветку Mojang**:

```java
    private static Found lookup(String nick) {
        networkFailed = false;
        String uuid = mojangUuid(nick);
        if (uuid != null) {
            Found f = mojangTextures(uuid);
            if (f != null) return f;
        }
        return new Found();   // задача 2 добавит сюда ely.by и запасные
    }
```

Задача 2 дописывает `elybyHas`, ветку запасных и `cape()`. Поля `capeUrl` в
`Found` и в мета-файле заводятся сразу, чтобы потом не переписывать `writeMeta`.

```java
    private static synchronized Path resolve(String nick, boolean wantCape) {
        if (!validNick(nick)) return null;
        Path dir = skinsDir();
        // Windows не различает регистр — «Steve» и «steve» одна папка
        String key = nick.toLowerCase();
        Path png  = dir.resolve(key + (wantCape ? ".cape.png" : ".png"));
        Path meta = dir.resolve(key + ".meta.json");

        long age = ageOf(meta);
        if (Files.exists(png) && age >= 0 && age < TTL_HIT)  return png;
        if (!Files.exists(png) && age >= 0 && age < TTL_MISS) return null;

        Found found;
        try {
            found = lookup(nick);
        } catch (Exception e) {
            // Сеть отвалилась — отдаём то, что уже лежит, вместо пустоты
            return Files.exists(png) ? png : null;
        }

        try {
            Files.createDirectories(dir);
            writeMeta(meta, found);
            Path plain = dir.resolve(key + ".png");
            Path cape  = dir.resolve(key + ".cape.png");
            if (!found.skinUrl.isEmpty()) download(found.skinUrl, plain);
            else Files.deleteIfExists(plain);
            if (!found.capeUrl.isEmpty()) download(found.capeUrl, cape);
            else Files.deleteIfExists(cape);
        } catch (Exception e) {
            System.out.println("[skin] не сохранил " + nick + ": " + e.getMessage());
        }
        return Files.exists(png) ? png : null;
    }

    private static long ageOf(Path meta) {
        if (!Files.exists(meta)) return -1;
        try {
            JsonObject o = JsonParser.parseString(Files.readString(meta, StandardCharsets.UTF_8)).getAsJsonObject();
            boolean hit = o.has("skinUrl") && !o.get("skinUrl").getAsString().isEmpty();
            long ttl = hit ? TTL_HIT : TTL_MISS;
            long at = o.get("fetchedAt").getAsLong();
            long age = System.currentTimeMillis() - at;
            return age < ttl ? age : -1;   // -1 = протухло
        } catch (Exception e) {
            return -1;
        }
    }

    private static void writeMeta(Path meta, Found f) throws Exception {
        JsonObject o = new JsonObject();
        o.addProperty("uuid", f.uuid);
        o.addProperty("skinUrl", f.skinUrl);
        o.addProperty("capeUrl", f.capeUrl);
        o.addProperty("source", f.source);
        o.addProperty("fetchedAt", System.currentTimeMillis());
        Files.writeString(meta, o.toString(), StandardCharsets.UTF_8);
    }

    /**
     * Проход по источникам.
     *
     * Порядок принципиален: Mojang и ely.by — разные системы аккаунтов, поэтому
     * чистый промах у первого не повод останавливаться. Запасные подключаются
     * только когда что-то упало: они не умеют говорить «нет такого».
     *
     * `http` не бросает исключений — он возвращает null и сам поднимает
     * networkFailed, поэтому try/catch здесь не нужен.
     */
    private static Found lookup(String nick) {
        networkFailed = false;

        // 1. Mojang — единственный, кто отдаёт и скин, и плащ
        String uuid = mojangUuid(nick);
        if (uuid != null) {
            Found f = mojangTextures(uuid);
            if (f != null) return f;
        }

        // 2. ely.by — другая система аккаунтов: ника у Mojang может не быть,
        //    а на ely.by он есть
        if (elybyHas(nick)) {
            Found f = new Found();
            f.source  = "ely.by";
            f.skinUrl = "https://skinsystem.ely.by/skins/" + nick + ".png";
            f.capeUrl = "https://skinsystem.ely.by/cloaks/" + nick + ".png";
            return f;
        }

        // 3. Запасные — только при сетевой беде. Плаща у них нет.
        if (networkFailed) {
            Found f = new Found();
            f.source  = "mc-heads";
            f.skinUrl = "https://mc-heads.net/skin/" + nick;
            return f;
        }

        return new Found();   // нигде не зарегистрирован
    }
```

**Важно про `networkFailed`.** Разница между «Mojang ответил 404» и «Mojang не
ответил» — это и есть граница между «идём дальше по покрытию» и «идём в
запасные». Заведи в классе поле:

```java
    /**
     * Выставляется, когда источник упал с ошибкой (сеть, 5xx), и НЕ выставляется
     * на чистый промах (404/204). Только по нему решается, звать ли запасные.
     */
    private static boolean networkFailed = false;
```

`resolve` объявлен `synchronized`, поэтому флаг не бывает нужен двум потокам
разом — но `http` его пишет, а читает `lookup`, так что сбрасывать его надо в
начале `lookup`, а не в `http`.

- [ ] **Шаг 4: добить зонд до зелёного**

Прогнать с песочным `APPDATA` — зонд пишет в папку данных:

```bash
cd /path/to/pulsePLUS-workspace
./build.sh
mkdir -p build/scratch/sandbox-skins
cd build/scratch
APPDATA="/path/to/pulsePLUS-workspace/build/scratch/sandbox-skins" \
java -cp ".;/path/to/pulsePLUS-workspace/build/classes;/path/to/pulsePLUS-workspace/src/lib/gson-2.10.1.jar" \
     SkinCheck
```
Ожидается: `ВСЁ ПРОШЛО`, код возврата 0, в песочнице появился `pulsePLUS/skins/herkulessi.png`.

- [ ] **Шаг 5: посмотреть на скачанный скин глазами**

Открыть `build/scratch/sandbox-skins/pulsePLUS/skins/herkulessi.png`. Убедиться,
что это похоже на персонажа (голова, торс, руки, ноги), а не на дефолтного Стива
и не на мусор. Это ловит случай, когда резолв вернул чужую текстуру.

---

### Задача 2: плащ и цепочка источников

**Файлы:**
- Изменить: `src/src/main/java/launcher/skin/SkinService.java`
- Изменить: `build/scratch/SkinCheck.java`

**Интерфейсы:**
- Использует: `SkinService.skin/cape/validNick` из задачи 1
- Отдаёт: поведение `cape()` и правило «ошибка против чистого промаха»

- [ ] **Шаг 1: расширить зонд**

Добавить в `main` до итогового вывода:

```java
        Path c = SkinService.cape("herkulessi");
        ok(c != null && Files.exists(c), "плащ herkulessi есть: " + c);
        ok(SkinService.skin("zzzznotreal99") == null,
           "ник, которого нет нигде, даёт null");
        ok(SkinService.skin("../../windows/win") == null,
           "ник с ../ не проходит валидацию");
        ok(SkinService.skin("Diamond") != null,
           "ник с ely.by (Diamond) находится через второй источник");

        // Второй прогон не должен ходить в сеть — проверяем по времени
        long t0 = System.currentTimeMillis();
        SkinService.skin("herkulessi");
        long dt = System.currentTimeMillis() - t0;
        ok(dt < 200, "повторный запрос берётся из кэша за " + dt + " мс");
```

- [ ] **Шаг 2: прогнать и увидеть провал**

```bash
cd build/scratch
APPDATA="/path/to/pulsePLUS-workspace/build/scratch/sandbox-skins" \
java -cp ".;/path/to/pulsePLUS-workspace/build/classes;/path/to/pulsePLUS-workspace/src/lib/gson-2.10.1.jar" \
     SkinCheck
```
Ожидается: `cape()` возвращает null — метод ещё не реализован.

- [ ] **Шаг 3: реализовать сетевые методы**

```java
    private static String mojangUuid(String nick) {
        byte[] b = http("https://api.mojang.com/users/profiles/minecraft/" + nick);
        if (b == null) return null;      // 404 — ник не занят, networkFailed не трогаем
        try {
            return JsonParser.parseString(new String(b, StandardCharsets.UTF_8))
                             .getAsJsonObject().get("id").getAsString();
        } catch (Exception e) {
            return null;
        }
    }

    private static Found mojangTextures(String uuid) {
        byte[] b = http("https://sessionserver.mojang.com/session/minecraft/profile/" + uuid);
        if (b == null) return null;
        try {
            JsonObject o = JsonParser.parseString(new String(b, StandardCharsets.UTF_8)).getAsJsonObject();
            if (!o.has("properties")) return null;
            String b64 = null;
            for (var p : o.getAsJsonArray("properties")) {
                JsonObject prop = p.getAsJsonObject();
                if ("textures".equals(prop.get("name").getAsString())) b64 = prop.get("value").getAsString();
            }
            if (b64 == null) return null;
            JsonObject t = JsonParser.parseString(
                    new String(Base64.getDecoder().decode(b64), StandardCharsets.UTF_8)).getAsJsonObject();
            if (!t.has("textures")) return null;
            JsonObject tex = t.getAsJsonObject("textures");
            Found f = new Found();
            f.uuid   = uuid;
            f.source = "mojang";
            // В ответе ссылки идут по http, но https на том же хосте отвечает
            if (tex.has("SKIN")) f.skinUrl = tex.getAsJsonObject("SKIN").get("url").getAsString();
            if (tex.has("CAPE")) f.capeUrl = tex.getAsJsonObject("CAPE").get("url").getAsString();
            return f.isEmpty() ? null : f;
        } catch (Exception e) {
            return null;
        }
    }

    /** 204 = такого ника на ely.by нет. Это чистый промах, а не ошибка. */
    private static boolean elybyHas(String nick) {
        return http("https://authserver.ely.by/api/users/profiles/minecraft/" + nick) != null;
    }

    private static void download(String url, Path to) throws Exception {
        byte[] b = http(url);
        // Пришёл не PNG — лучше пусто, чем битый файл на диске
        if (b == null || b.length < 8 || b[0] != (byte) 0x89 || b[1] != 'P') {
            Files.deleteIfExists(to);
            return;
        }
        Files.createDirectories(to.getParent());
        Files.write(to, b);
    }

    /**
     * Тело ответа, либо null.
     *
     * null означает и «чистый промах» (404/204), и «источник недоступен» —
     * различает их только флаг networkFailed. Исключений не бросает намеренно:
     * вызывающий код тогда читается линейно, без try вокруг каждого запроса.
     */
    private static byte[] http(String url) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) URI.create(url).toURL().openConnection();
            c.setConnectTimeout(TIMEOUT);
            c.setReadTimeout(TIMEOUT);
            // Без своего User-Agent ely.by и Mojang отвечают по-разному
            c.setRequestProperty("User-Agent", "vulkan-launcher/2.0");
            c.setInstanceFollowRedirects(true);
            int code = c.getResponseCode();
            if (code == 204 || code == 404) return null;    // чистый промах
            if (code >= 400) { networkFailed = true; return null; }
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                in.transferTo(out);
                return out.toByteArray();
            }
        } catch (Exception e) {
            networkFailed = true;
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }
```

- [ ] **Шаг 4: прогнать зонд**

Та же команда, что в шаге 2. Ожидается `ВСЁ ПРОШЛО`.

- [ ] **Шаг 5: проверить плащ глазами**

Открыть `build/scratch/sandbox-skins/pulsePLUS/skins/herkulessi.cape.png`. Должен
быть PNG 64×32 с рисунком плаща на левой половине — не пустой и не 64×64.

---

### Задача 3: эндпоинт `/api/skin`

**Файлы:**
- Изменить: `src/src/main/java/launcher/web/WebServer.java` (регистрация — рядом со строкой 49, обработчик — рядом с `handleState`)

**Интерфейсы:**
- Использует: `SkinService.skin/cape/validNick/skinsDir` из задач 1–2
- Отдаёт: `GET /api/skin/{ник}` → `image/png` | 404; `GET /api/skin/{ник}/cape` → то же

- [ ] **Шаг 1: зарегистрировать контекст и написать обработчик**

Регистрация (одна строка, рядом с прочими `createContext`):

```java
server.createContext("/api/skin", this::handleSkin);
```

Обработчик. **Контекст один намеренно:** `HttpServer` сопоставляет по префиксу,
и отдельный `createContext("/api/skin/cape")` не поймал бы
`/api/skin/herkulessi/cape` — пути начинаются по-разному.

```java
    /**
     * /api/skin/{ник}       — скин
     * /api/skin/{ник}/cape  — плащ
     *
     * Отдаём файл из кэша, качая при промахе. Браузер не ходит наружу: в
     * scene.js текстура уходит в drawImage, и загрузка с чужого домена сделала
     * бы канвас «грязным».
     */
    private void handleSkin(HttpExchange ex) throws IOException {
        cors(ex);
        if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) { send(ex, 204, "text/plain", ""); return; }

        String[] parts = ex.getRequestURI().getPath().split("/");
        // ["", "api", "skin", "<ник>"] или ["", "api", "skin", "<ник>", "cape"]
        if (parts.length < 4) { send(ex, 400, "text/plain", "Bad Request"); return; }
        String nick   = parts[3];
        boolean cape  = parts.length >= 5 && parts[4].equals("cape");

        if (!launcher.skin.SkinService.validNick(nick)) {
            send(ex, 400, "text/plain", "Bad nickname");
            return;
        }
        Path p = cape ? launcher.skin.SkinService.cape(nick)
                      : launcher.skin.SkinService.skin(nick);
        if (p == null || !Files.exists(p)) { send(ex, 404, "text/plain", "No skin"); return; }

        byte[] bytes = Files.readAllBytes(p);
        ex.getResponseHeaders().set("Content-Type", "image/png");
        // Скин меняется редко, а TTL кэша — сутки; сутки и разрешаем держать
        ex.getResponseHeaders().set("Cache-Control", "max-age=86400");
        ex.sendResponseHeaders(200, bytes.length);
        ex.getResponseBody().write(bytes);
        ex.close();
    }
```

- [ ] **Шаг 2: собрать и поднять стенд на отдельном порту**

```bash
cd /path/to/pulsePLUS-workspace
./build.sh
mkdir -p build/scratch/sandbox-skins
APPDATA="/path/to/pulsePLUS-workspace/build/scratch/sandbox-skins" \
java -jar build/libs/vulkan-launcher.jar --server --port 47910
```

- [ ] **Шаг 3: проверить эндпоинт**

```bash
curl -s -o /tmp/s.png -w "%{http_code} %{content_type} %{size_download}\n" \
     http://127.0.0.1:47910/api/skin/herkulessi
curl -s -o /tmp/c.png -w "%{http_code} %{content_type} %{size_download}\n" \
     http://127.0.0.1:47910/api/skin/herkulessi/cape
curl -s -o /dev/null -w "мусорный ник: %{http_code}\n" \
     http://127.0.0.1:47910/api/skin/zzzznotreal99
curl -s -o /dev/null -w "traversal:    %{http_code}\n" \
     "http://127.0.0.1:47910/api/skin/..%2f..%2fwin.ini"
```
Ожидается: `200 image/png` для первых двух, `404` для мусорного ника, `400` для
traversal. Файлы `/tmp/s.png` — 64×64, `/tmp/c.png` — 64×32.

---

### Задача 4: голова вместо буквы

**Файлы:**
- Изменить: `src/src/main/resources/web/js/app.js` (`applyActiveAccountToSidebar`, ~строка 568; `renderAccounts`, ~строка 633)
- Изменить: `src/src/main/resources/web/index.html` (`.avatar`, строка 85)
- Изменить: `src/src/main/resources/web/css/style.css` (`.avatar`)

**Интерфейсы:**
- Использует: `/api/skin/{ник}` из задачи 3
- Отдаёт: функция `applySkinToAvatar(el, nick)`

- [ ] **Шаг 1: написать функцию и подключить её**

Буква остаётся **под** картинкой: она работает и подложкой, и откатом - если
картинка не пришла, ничего не мигает и не ломается.

```js
/**
 * Голова игрока вместо буквы.
 *
 * Буква не убирается, а остаётся под картинкой: она и подложка на время
 * загрузки, и откат, если скина нет. Так аватар никогда не бывает пустым.
 */
function applySkinToAvatar(el, nick) {
  if (!el || !nick) return;
  const img = new Image();
  img.className = 'avatar-skin';
  img.alt = '';
  img.onerror = () => img.remove();          // скина нет — остаётся буква
  img.src = '/api/skin/' + encodeURIComponent(nick);
  el.appendChild(img);
}

/** Снять прошлую голову, чтобы при смене аккаунта не осталась старая. */
function clearSkinFromAvatar(el) {
  if (!el) return;
  el.querySelectorAll('.avatar-skin').forEach((n) => n.remove());
}
```

Использование:

```js
  const avatar = $('#avatar');
  if (avatar) {
    avatar.textContent = initial;
    clearSkinFromAvatar(avatar);
    applySkinToAvatar(avatar, name);
  }
```

и в `renderAccounts`, сразу после
`avatar.textContent = acc.initial || acc.name.charAt(0).toUpperCase();`:

```js
    clearSkinFromAvatar(avatar);
    applySkinToAvatar(avatar, acc.name);
```

- [ ] **Шаг 2: стиль**

```css
/* Голова лежит поверх буквы, поэтому аватар позиционируется */
.avatar { position: relative; overflow: hidden; }
.avatar-skin {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  /* Пиксель-арт: сглаживание превращает лицо в кашу */
  image-rendering: pixelated;
  object-fit: cover;
}
```

- [ ] **Шаг 3: поднять стенд и проверить вживую**

```bash
cd /path/to/pulsePLUS-workspace/build/scratch/uicheck
node serve-src.cjs 47900 47910
```
Затем прогнать зонд по DOM:

```bash
cd /path/to/pulsePLUS-workspace/build/scratch
LAUNCHER_URL="http://127.0.0.1:47900/?mode=vanilla" node inspect-sidebar.cjs
```

Ожидается: у `#avatar` есть дочерний `img.avatar-skin` с `src`, начинающимся на
`/api/skin/`, и `naturalWidth == 64`.

- [ ] **Шаг 4: посмотреть на кадр**

Тот же стенд, `shot-live.cjs` → открыть `live-sidebar.png` и убедиться глазами,
что в аватаре голова игрока, а не буква и не битая картинка.

---

### Задача 5: скин на Стиве

**Файлы:**
- Изменить: `src/src/main/resources/web/js/scene.js` (`TEX_FILES`, строка 29; `loadTextures`, ~строка 254)
- Изменить: `src/src/main/resources/web/js/app.js` (передача ника в сцену)

**Интерфейсы:**
- Использует: `/api/skin/{ник}` из задачи 3
- Отдаёт: `Scene.setPlayerSkin(nick)`

- [ ] **Шаг 1: сделать текстуру игрока сменной**

`TEX_FILES.steve` сейчас жёстко `'steve.png'`. Оставляем его как **откат**, а
поверх добавляем подмену:

```js
    /**
     * Подменить текстуру игрока на скин аккаунта.
     *
     * Модель переделывать не надо: развёртка в этом файле — ровно ванильный
     * атлас (голова [0,0], торс [16,16], руки [40,16]/[32,48], ноги [0,16]/[0,22]),
     * поэтому настоящий скин 64x64 ложится на неё как есть.
     *
     * Если скин не пришёл — остаётся steve.png: пустой Стив выглядел бы дырой
     * в сцене, а дефолтный — это ровно то, что показывает сама игра.
     */
    async setPlayerSkin(nick) {
      if (!nick) return;
      const img = await loadImage('/api/skin/' + encodeURIComponent(nick));
      // Легаси 64x32 не подходит: у него нет отдельной левой руки и ноги
      this.tex.steve = (img && img.width === 64 && img.height === 64) ? img : this.tex.steveFallback;
    },
```

`setPlayerSkin` — метод объекта `Scene`, рядом с `drawPlayer`, а не отдельная
функция: он работает с `this.tex`. Заодно в `loadTextures` сохрани `дефолтного`
Стива в `this.tex.steveFallback`, иначе после первой подмены откатываться будет
некуда.

- [ ] **Шаг 2: позвать из app.js**

Там, где сцена инициализируется (`Scene.init(...)`), после успешной загрузки
вызвать `Scene.setPlayerSkin(имяАктивногоАккаунта)` и повторять тот же вызов в
`applyActiveAccountToSidebar()` — при смене аккаунта Стив должен переодеваться.

- [ ] **Шаг 3: проверить вживую**

Стенд из задачи 4, `shot-live.cjs`, открыть `live-main.png`. Стив должен быть в
скине активного аккаунта. Сверить с файлом из
`build/scratch/sandbox-skins/pulsePLUS/skins/`.

- [ ] **Шаг 4: проверить откат**

Подменить `APPDATA` на пустую песочницу (без кэша) и выключить сеть — Стив должен
остаться дефолтным, в консоли ноль ошибок. Это проверяет, что `.png`-откат живой.

---

### Задача 6: плащ у Стива

**Файлы:**
- Изменить: `src/src/main/resources/web/js/scene.js` (`PLAYER_BODY`, строка 78; `drawPlayer`, строка 490; `collectBox`, строка 565)

**Интерфейсы:**
- Использует: `cape()` из задачи 2 через `/api/skin/{ник}/cape`
- Отдаёт: поле `tex` в том, что возвращает `collectBox`

- [ ] **Шаг 1: добавить коробку плаща**

Раскладка проверена на настоящем плаще — `boxFaces([0,0],10,16,1)` покрывает
`x 0..21, y 0..16`, что совпадает с картой прозрачности реального плаща пиксель в
пиксель (см. `design/skins.md`). Колонка `x=22` ниже `y=11` относится к модели
1.9+ и к нашей коробке не относится.

```js
  // Плащ: коробка 10x16x1 за спиной. Наружная сторона в раскладке Minecraft —
  // это грань 'back' (область 12,1 10x16).
  const PLAYER_CAPE = { id: 'cape', uv: [0, 0], from: [-5, 12, -3], to: [5, 28, -2], tex: 'cape' };
```

- [ ] **Шаг 2: научить отрисовку брать разные текстуры**

`drawPlayer` сейчас передаёт одну `tex` во все грани:

```js
        drawQuad(pctx, tex, f.quad, f.uv, f.shade, 1);
```

Станет:

```js
        // У плаща своя текстура 64x32, у тела — скин 64x64
        drawQuad(pctx, f.tex === 'cape' ? this.tex.cape : tex, f.quad, f.uv, f.shade, 1);
```

Для этого `collectBox` должен протащить признак: в объект, который он кладёт в
`out`, добавить `tex: box.tex || 'skin'`.

- [ ] **Шаг 3: грузить текстуру плаща**

В `loadTextures` добавить `cape: null`, и в `setPlayerSkin` (задача 5) рядом со
скином грузить `/api/skin/{ник}/cape`. Плаща может не быть — тогда
`this.tex.cape = null`, и коробку плаща рисовать не нужно.

- [ ] **Шаг 4: не рисовать пустой плащ**

В `drawPlayer` перед циклом по коробкам пропускать плащ, если текстуры нет:

```js
        // Коробки плаща нет смысла собирать, когда плаща нет: у большинства
        // аккаунтов его не бывает
        if (box.id === 'cape' && !this.tex.cape) continue;
```

- [ ] **Шаг 5: проверить вживую и посмотреть на кадр**

Стенд, `shot-live.cjs`, `live-main.png`. У Стива за спиной плащ. **Какую грань
видно — решается по кадру, а не по рассуждению.** Камера диорамы стоит спереди
(`VIEW_YAW` 26°), плащ висит сзади. Если видна внутренняя, нераскрашенная
сторона — поменять местами грани `front` и `back` у коробки плаща (сдвинуть `uv`
на ширину грани) и снять кадр снова.

- [ ] **Шаг 6: проверить, что у аккаунта без плаща ничего не ломается**

`bepro_` плаща не имеет — сделать его активным, снять кадр, убедиться, что Стив
без плаща и без пустой коробки за спиной.

---

## Что этот план НЕ делает

- Не поддерживает тонкую модель (Alex) — только классические руки. Причина в
  `design/skins.md`.
- Не легаси-скины 64×32: такие откатываются на дефолтного Стива (шаг 1 задачи 5).
  Отдельная задача — если пользователь захочет, левым конечностям подставляются
  UV правых.
- Не трогает запуск игры: скин виден только в лаунчере. Как он попадёт в саму
  игру под офлайн-аккаунтом — отдельная тема.
