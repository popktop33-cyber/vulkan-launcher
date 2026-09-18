package launcher.skin;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import launcher.LauncherConfig;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/**
 * Каталог скинов ely.by — витрина внутри лаунчера.
 *
 * Сайт отдаёт каталог не страницей, а JSON:
 *
 *   POST https://ely.by/skins/get?_url=%2Fskins   тело: skinsPage=N
 *   -> {items:[{id, skin_url, is_slim, tags, count_wearers, ...}],
 *       total_items, current, next, last}
 *
 * Разобрано живьём: 250 страниц по 40 скинов, всего 10000. Страница 1 отдаётся
 * тем же POST, отдельный путь для неё не нужен.
 *
 * Адрес скина ведёт прямо на https://ely.by/storage/skins/<md5>.png, поэтому
 * наружу отсюда уходит не адрес, а только сам хеш — см. preview().
 */
public final class ElybyCatalog {

    private ElybyCatalog() {}

    /** Страница каталога держится полчаса: за секунды она не меняется. */
    private static final long PAGE_TTL = 30 * 60 * 1000L;
    private static final int  TIMEOUT  = 12000;
    private static final String UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
          + "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

    /** Один скин витрины. Наружу отдаётся именно это, без сырых полей сайта. */
    public static final class Skin {
        public int id;
        /** md5 картинки на сайте. Адрес собираем сами — чужой URL в прокси не пускаем. */
        public String hash;
        public boolean slim;
        public int wearers;
        public List<String> tags = new ArrayList<>();
        /** Наш вердикт «взрослое». Сайт такого поля не отдаёт вовсе. */
        public boolean adult;
    }

    /** Страница каталога. */
    public static final class Page {
        public List<Skin> items = new ArrayList<>();
        public int page = 1;
        public int last = 1;
        public int total = 0;
    }

    public static Path dir() {
        return LauncherConfig.dataDir().resolve("skins").resolve("catalog");
    }

    // ── Каталог ─────────────────────────────────────────────────────────────

    /**
     * Страница каталога. С дисковой отметкой времени: пролистывание туда-сюда
     * не должно каждый раз дёргать ely.by.
     *
     * Отбор по тегу в кэш не идёт — он у каждого свой и меняется на лету.
     */
    public static synchronized Page page(int n, String query) {
        if (n < 1) n = 1;
        String q = query == null ? "" : query.trim();
        Path cache = q.isEmpty() ? dir().resolve("page-" + n + ".json") : null;

        if (cache != null && fresh(cache)) {
            try {
                Page p = parse(Files.readString(cache, StandardCharsets.UTF_8));
                if (!p.items.isEmpty()) return p;
            } catch (Exception e) {
                // битый кэш — просто идём в сеть
            }
        }

        // Параметр называется tags, а не searchQuery, и это ФИЛЬТР ПО ТЕГУ, а не
        // свободный поиск: свободного у ely.by нет вовсе. Проверено живьём —
        // tags=anime сужает выдачу с 10000 до 5508, а searchQuery не делает
        // ничего. Имя взято из их же кода: список фильтров у сайта — это
        // sort, kind, color, tags, uploader, type, isStored, showSensitiveContent.
        String body = "skinsPage=" + n + (q.isEmpty() ? "" : "&tags=" + enc(q));
        byte[] raw = post("https://ely.by/skins/get?_url=%2Fskins", body);
        if (raw == null) {
            // Сеть отвалилась — отдаём то, что уже лежит, лишь бы витрина не пустела
            if (cache != null && Files.exists(cache)) {
                try { return parse(Files.readString(cache, StandardCharsets.UTF_8)); }
                catch (Exception ignored) { }
            }
            return new Page();
        }
        String json = new String(raw, StandardCharsets.UTF_8);
        if (cache != null) {
            try {
                Files.createDirectories(dir());
                Files.writeString(cache, json, StandardCharsets.UTF_8);
            } catch (Exception e) {
                System.out.println("[elyby] не сохранил страницу " + n + ": " + e.getMessage());
            }
        }
        return parse(json);
    }

    // ── Досмотр картинок ────────────────────────────────────────────────────

    /**
     * Сколько ждём досмотр страницы, мс.
     *
     * Дольше ждать нельзя: обработчик HTTP-запроса стоит на этом месте, и
     * витрина просто не откроется. Не успевшее — останется недосмотренным;
     * при следующем показе той же страницы картинки уже лежат на диске, и
     * досмотр проходит мгновенно.
     */
    private static final long SCREEN_BUDGET = 7000;

    /**
     * Вердикты по содержимому картинки: хеш -> голый ли скин.
     *
     * Хеш — это содержимое файла, поэтому вердикт верен навсегда и переживает
     * любые перезагрузки страниц. В памяти, а не на диске: пересчитать его по
     * уже скачанной картинке стоит микросекунды, хранить нечего.
     */
    private static final Map<String, Boolean> NAKED = new ConcurrentHashMap<>();

    /**
     * Пул на досмотр. Шесть потоков — это шесть картинок разом: больше не
     * нужно, а ely.by за жадность наказывает обрывом связи.
     */
    private static final ExecutorService POOL = Executors.newFixedThreadPool(6, (r) -> {
        Thread t = new Thread(r, "elyby-screen");
        t.setDaemon(true);      // не держим лаунчер открытым из-за досмотра
        return t;
    });

    /**
     * Досматривает страницу по картинкам: теги врут и молчат.
     *
     * Зачем это вообще нужно. Теги ставит тот, кто скин загрузил, и половина
     * авторов голых скинов не пишет ни «Nude», ни «NSFW» — скин уходит в
     * каталог с тегами «Girl, Anime, Cute» и спокойно проходит наш фильтр по
     * тегам. Замерено на 221 скине: 6 голых мимо тегов, то есть около 3%.
     * Поймать их можно только по самой картинке.
     *
     * Отдельной загрузки здесь нет: картинки и так качаются для витрины, и
     * лежат в том же дисковом кэше. То есть досмотр стоит ноль байт — он лишь
     * переносит загрузку на момент показа страницы, а не на момент отрисовки.
     *
     * Уже признанные взрослыми по тегам не досматриваются: незачем.
     */
    public static void screen(Page p) {
        if (p == null || p.items.isEmpty()) return;
        List<Future<?>> jobs = new ArrayList<>();
        for (Skin s : p.items) {
            if (s.adult) continue;
            Boolean known = NAKED.get(s.hash);
            if (known != null) {
                s.adult = known;
                continue;
            }
            jobs.add(POOL.submit(() -> {
                Path png = preview(s.hash);
                if (png == null) return;
                boolean naked = looksNude(png, s.slim);
                NAKED.put(s.hash, naked);
                s.adult = naked;
            }));
        }

        long deadline = System.currentTimeMillis() + SCREEN_BUDGET;
        for (Future<?> f : jobs) {
            long left = deadline - System.currentTimeMillis();
            if (left <= 0) return;          // не успели — досмотрим в следующий раз
            try {
                f.get(left, TimeUnit.MILLISECONDS);
            } catch (Exception ignored) {
                // одна не разобранная картинка не повод ронять всю страницу
            }
        }
    }

    /**
     * Порог, с которого считаем скин голым.
     *
     * Не взят с потолка. Замер на 218 скинах каталога, прошедших фильтр по
     * тегам, дал такой расклад по доле тела, совпавшей с тоном лица:
     *
     *   1.00, 0.88, 0.83 — голые (проверены глазами по картинке)
     *   0.74, 0.68, 0.65, 0.62, 0.59, 0.58 — одетые
     *   0.43 и ниже — заведомо одетые
     *
     * Между 0.74 и 0.83 — разрыв, в нём и стоит порог. Ниже опускать нельзя:
     * 0.74 — это персонаж с открытыми ногами, но в одежде. Выше поднимать
     * тоже: 0.83 — это скин со стрингами, и он обязан быть скрыт.
     */
    private static final double NUDE_LIMIT = 0.78;

    /** Передняя грань головы: (x, y, ширина, высота). Там всегда кожа. */
    private static final int[] FACE_BOX = {8, 8, 8, 8};

    /** Передние грани тела, рук и ног — по ним и считаем. */
    private static final int[][] BODY_BOXES = {
        {20, 20, 8, 12},   // торс
        {4,  20, 4, 12},   // правая нога
        {44, 20, 4, 12},   // правая рука
        {20, 52, 4, 12},   // левая нога — только формат 1.8
        {36, 52, 4, 12}    // левая рука — только формат 1.8
    };

    /**
     * Голый ли скин — по самой текстуре.
     *
     * Лицо берётся эталоном: оно кожа всегда, даже под маской. Дальше смотрим,
     * какая доля тела, рук и ног совпадает с этим тоном. У одетого скина там
     * рубашка и штаны — совпадение низкое. У голого тело целиком кожа.
     *
     * Ложные срабатывания отсекаются двумя способами. Первый: эталон обязан
     * быть правдоподобным тоном человеческой кожи, а не просто цветом. Второй:
     * тон обязан быть тёплым (R > G > B) и не серым. Без этого сплошной
     * зелёный слайм или чёрный ниндзя тоже «совпали бы» с собственным лицом.
     *
     * Открыт наружу ради NudeTest: он прогоняет по сотне настоящих картинок
     * из каталога и сверяет ответ с тем, что даёт тот же счёт на Python.
     * Расхождение означало бы ошибку переноса, а не ошибку порога.
     */
    public static boolean looksNude(Path png, boolean slim) {
        BufferedImage img;
        try {
            img = ImageIO.read(png.toFile());
        } catch (Exception e) {
            return false;
        }
        if (img == null || img.getWidth() < 64 || img.getHeight() < 32) return false;

        // Эталон — самый частый кожный тон на лице. Квантуем по 8: одна и та же
        // кожа на скине нарисована с разбросом в пару единиц, и без укрупнения
        // голоса разошлись бы между почти одинаковыми оттенками.
        Map<Integer, Integer> tones = new java.util.HashMap<>();
        for (int x = FACE_BOX[0]; x < FACE_BOX[0] + FACE_BOX[2]; x++) {
            for (int y = FACE_BOX[1]; y < FACE_BOX[1] + FACE_BOX[3]; y++) {
                int argb = img.getRGB(x, y);
                if (!skinTone(argb)) continue;
                int key = (rgb(argb, 16) << 16) | (rgb(argb, 8) << 8) | rgb(argb, 0);
                tones.merge(key, 1, Integer::sum);
            }
        }
        if (tones.isEmpty()) return false;      // лицо не кожа — это не человек

        int best = -1, bestCount = -1;
        for (Map.Entry<Integer, Integer> e : tones.entrySet()) {
            if (e.getValue() > bestCount) { bestCount = e.getValue(); best = e.getKey(); }
        }
        int tr = (best >> 16) & 0xFF, tg = (best >> 8) & 0xFF, tb = best & 0xFF;

        boolean old = img.getHeight() == 32;    // старый формат: левых частей нет
        int hit = 0, total = 0;
        for (int i = 0; i < BODY_BOXES.length; i++) {
            if (old && i >= 3) break;
            int[] b = BODY_BOXES[i];
            // Рукав тонкой модели на пиксель уже — краешек чужой грани не считаем
            int w = (slim && (i == 2 || i == 4)) ? b[2] - 1 : b[2];
            for (int x = b[0]; x < b[0] + w; x++) {
                for (int y = b[1]; y < b[1] + b[3]; y++) {
                    total++;
                    int argb = img.getRGB(x, y);
                    if (Math.abs(rgb(argb, 16) - tr) <= 26
                     && Math.abs(rgb(argb, 8) - tg) <= 26
                     && Math.abs(rgb(argb, 0) - tb) <= 26) hit++;
                }
            }
        }
        if (total == 0) return false;
        return (hit / (double) total) >= NUDE_LIMIT;
    }

    /** Канал цвета: 16 — красный, 8 — зелёный, 0 — синий. */
    private static int rgb(int argb, int shift) {
        return (argb >> shift) & 0xFF;
    }

    /** Правдоподобный ли это тон человеческой кожи, а не просто цвет. */
    private static boolean skinTone(int argb) {
        if (((argb >>> 24) & 0xFF) < 200) return false;   // прозрачное — не кожа
        int r = rgb(argb, 16), g = rgb(argb, 8), b = rgb(argb, 0);
        if (r < 110) return false;                        // слишком тёмное
        if (!(r > g && g > b)) return false;              // кожа тёплая
        if (r - b < 15) return false;                     // серое
        if (r - g > 90) return false;                     // кислотно-оранжевое
        return true;
    }

    private static boolean fresh(Path p) {
        try {
            return Files.exists(p)
                && System.currentTimeMillis() - Files.getLastModifiedTime(p).toMillis() < PAGE_TTL;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Разбор ответа сайта.
     *
     * is_processed=false означает, что картинку ещё не обработали и она может
     * не открыться, — такие пропускаем, иначе в сетке будут дыры.
     */
    private static Page parse(String json) {
        Page out = new Page();
        try {
            JsonObject o = JsonParser.parseString(json).getAsJsonObject();
            out.page  = num(o, "current", 1);
            out.last  = num(o, "last", 1);
            out.total = num(o, "total_items", 0);
            JsonArray items = o.has("items") ? o.getAsJsonArray("items") : new JsonArray();
            for (JsonElement el : items) {
                JsonObject s = el.getAsJsonObject();
                if (s.has("is_processed") && !s.get("is_processed").getAsBoolean()) continue;
                String url = s.has("skin_url") ? s.get("skin_url").getAsString() : "";
                String hash = hashOf(url);
                if (hash.isEmpty()) continue;

                Skin sk = new Skin();
                sk.id      = num(s, "id", 0);
                sk.hash    = hash;
                sk.slim    = s.has("is_slim") && s.get("is_slim").getAsBoolean();
                sk.wearers = num(s, "count_wearers", 0);
                if (s.has("tags") && s.get("tags").isJsonArray()) {
                    for (JsonElement t : s.getAsJsonArray("tags")) {
                        sk.tags.add(t.getAsString());
                    }
                }
                sk.adult = adult(sk.tags);
                out.items.add(sk);
            }
        } catch (Exception e) {
            System.out.println("[elyby] не разобрал каталог: " + e.getMessage());
        }
        return out;
    }

    private static int num(JsonObject o, String key, int def) {
        try { return o.has(key) ? o.get(key).getAsInt() : def; }
        catch (Exception e) { return def; }
    }

    /**
     * md5 из адреса вида https://ely.by/storage/skins/<md5>.png.
     *
     * Возвращаем именно хеш, а не адрес: клиент просит картинку по хешу, а
     * полный адрес собирает preview(). Иначе через прокси можно было бы
     * вытянуть любой чужой URL.
     */
    private static String hashOf(String url) {
        if (url == null) return "";
        int slash = url.lastIndexOf('/');
        if (slash < 0) return "";
        String name = url.substring(slash + 1);
        int dot = name.indexOf('.');
        if (dot > 0) name = name.substring(0, dot);
        return name.matches("[0-9a-fA-F]{32}") ? name.toLowerCase(Locale.ROOT) : "";
    }

    // ── Фильтр «18+» ────────────────────────────────────────────────────────

    /**
     * Корни, у которых важен только НАЧАЛО слова.
     *
     * Справа продолжение разрешено намеренно: иначе «nude» не поймал бы
     * «nudes», а «sex» — «sexy». Слева граница обязательна, и это как раз
     * спасает от «class» внутри «ass»: там корень начинается в середине слова.
     */
    private static final String[] ADULT_PREFIX = {
        "sex", "porn", "nude", "naked", "nsfw", "hentai", "erotic", "boob",
        "nipple", "pussy", "vagina", "penis", "sperm", "milf", "femboy",
        "panties", "lingerie", "bikini", "onlyfans", "slipperyt", "strippable",
        "horny", "adult",
        // Добрано по переписи тегов каталога: 1200 скинов, 1192 разных тега.
        // «Стринги» нашлись именно так — скин с ними прошёл фильтр насквозь.
        "ecchi", "ahegao", "rule34", "futanari", "escort", "bdsm",
        // русские
        "сексуальн", "порн", "эрот", "нюд", "хентай", "сиськ", "сисек",
        "разврат", "пошл", "интим", "трусик", "трусы", "лифчик",
        "бюстгальтер", "обнаж", "взросл", "жоп", "попк",
        "стринг", "милф", "орги", "проститут", "шлюх", "бляд", "инцест",
        "изнасил", "вибратор", "свингер"
    };

    /**
     * Корни, которые засчитываются только словом целиком.
     *
     * Все они — начало других, безобидных слов: «ass» есть в «assassin»,
     * «bra» в «brand», «tit» в «title», «anal» в «analysis», «cum» в
     * «cumulative». Разреши им продолжение — и фильтр начнёт прятать
     * обычные скины.
     */
    private static final String[] ADULT_EXACT = {
        "ass", "bra", "tit", "anal", "anus", "cum", "dick", "cock", "trap",
        "thong", "underwear", "topless", "xxx", "18+", "+18", "18 plus",
        // «futa» стоит здесь, а не среди корней: корнем он поймал бы Futaba
        // из Persona 5 — имя персонажа начинается с тех же четырёх букв
        "futa", "18 плюс", "jenny",
        // русские
        "секс", "голый", "голая", "голые", "нагота", "нагой", "нагая",
        "член", "минет", "без одежды"
    };

    /**
     * Взрослый ли скин — по тегам.
     *
     * Поля is_sensitive в ответе каталога нет вовсе (проверено на живом API:
     * его нет ни при showSensitiveContent=1, ни без). Флаг showSensitiveContent
     * меняет 3 скина из 40 — это личный список скрытого у самого игрока, а не
     * классификация. Значит, решать приходится нам, и только по тегам.
     *
     * Список собран не наугад: 12 страниц каталога (480 скинов) разобраны по
     * тегам. Оттуда видно и то, что в список пускать НЕЛЬЗЯ: «girl» — самый
     * частый тег каталога (48 из 480), и он сплошь невинные аниме-скины.
     *
     * Теги локализованы: один и тот же скин приходит и как «Adolf Hitler», и
     * как «Адольф Гитлер». Поэтому корни русские и английские вперемешку —
     * иначе половина взрослого пролезла бы.
     */
    public static boolean adult(List<String> tags) {
        if (tags == null) return false;
        for (String tag : tags) {
            if (tag == null) continue;
            String low = tag.toLowerCase(Locale.ROOT);
            for (String root : ADULT_PREFIX) {
                if (startsWord(low, root)) return true;
            }
            for (String root : ADULT_EXACT) {
                if (isWord(low, root)) return true;
            }
        }
        return false;
    }

    /** Корень стоит в начале какого-то слова; что идёт следом — не важно. */
    private static boolean startsWord(String haystack, String needle) {
        int from = 0;
        while (true) {
            int i = haystack.indexOf(needle, from);
            if (i < 0) return false;
            if (i == 0 || !isWord(haystack.charAt(i - 1))) return true;
            from = i + 1;
        }
    }

    /** Корень стоит отдельным словом целиком. */
    private static boolean isWord(String haystack, String needle) {
        int from = 0;
        while (true) {
            int i = haystack.indexOf(needle, from);
            if (i < 0) return false;
            boolean leftOk  = i == 0 || !isWord(haystack.charAt(i - 1));
            int end = i + needle.length();
            boolean rightOk = end >= haystack.length() || !isWord(haystack.charAt(end));
            if (leftOk && rightOk) return true;
            from = i + 1;
        }
    }

    private static boolean isWord(char c) {
        return Character.isLetterOrDigit(c);
    }

    // ── Картинки ────────────────────────────────────────────────────────────

    /**
     * Превью скина по хешу — файл на диске, при первом обращении скачивается.
     *
     * Адрес собирается здесь из одного лишь хеша, прошедшего проверку на
     * формат. Клиент не может подсунуть сюда чужой URL, так что прокси не
     * превращается в способ ходить по произвольным адресам.
     *
     * Кэш вечный: хеш — это содержимое файла, при том же хеше картинка та же.
     */
    public static Path preview(String hash) {
        if (hash == null || !hash.matches("[0-9a-f]{32}")) return null;
        Path png = dir().resolve(hash + ".png");
        if (Files.exists(png) && size(png) > 0) return png;

        byte[] b = get("https://ely.by/storage/skins/" + hash + ".png");
        if (b == null || b.length < 8 || b[0] != (byte) 0x89 || b[1] != 'P') return null;
        try {
            Files.createDirectories(dir());
            // Пишем во временный файл и переносим: досмотр страницы тянет
            // картинки в шесть потоков, и без этого витрина могла бы прочитать
            // наполовину записанный файл. Имя с потоком — чтобы два потока,
            // взявшие один хеш, не толкались в одном временном файле.
            Path tmp = png.resolveSibling(hash + "-" + Thread.currentThread().getId() + ".part");
            Files.write(tmp, b);
            Files.move(tmp, png, StandardCopyOption.REPLACE_EXISTING);
        } catch (Exception e) {
            System.out.println("[elyby] не сохранил превью " + hash + ": " + e.getMessage());
            return null;
        }
        return png;
    }

    private static long size(Path p) {
        try { return Files.size(p); } catch (Exception e) { return 0; }
    }

    // ── Сеть ────────────────────────────────────────────────────────────────

    private static String enc(String s) {
        try {
            return java.net.URLEncoder.encode(s, StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
        }
    }

    /** POST формы. null означает «не получилось». */
    private static byte[] post(String url, String body) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) URI.create(url).toURL().openConnection();
            c.setConnectTimeout(TIMEOUT);
            c.setReadTimeout(TIMEOUT);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("User-Agent", UA);
            // Без этого заголовка сайт отвечает целой страницей вместо JSON
            c.setRequestProperty("X-Requested-With", "XMLHttpRequest");
            c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
            byte[] out = body.getBytes(StandardCharsets.UTF_8);
            c.setFixedLengthStreamingMode(out.length);
            try (OutputStream os = c.getOutputStream()) { os.write(out); }
            int code = c.getResponseCode();
            if (code >= 400) return null;
            try (InputStream in = c.getInputStream()) { return read(in); }
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static byte[] get(String url) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) URI.create(url).toURL().openConnection();
            c.setConnectTimeout(TIMEOUT);
            c.setReadTimeout(TIMEOUT);
            c.setRequestProperty("User-Agent", UA);
            if (c.getResponseCode() >= 400) return null;
            try (InputStream in = c.getInputStream()) { return read(in); }
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static byte[] read(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        in.transferTo(out);
        return out.toByteArray();
    }
}
