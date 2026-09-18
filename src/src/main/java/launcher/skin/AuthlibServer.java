package launcher.skin;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.sun.net.httpserver.HttpExchange;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;

/**
 * Сервер авторизации для игры — свой, на 127.0.0.1, из кэша на диске.
 *
 * Агент authlib-injector умеет работать не только с ely.by, но и с любым
 * сервером, отдающим тот же протокол: при запуске он спрашивает у адреса
 * метаданные, а дальше клиент ходит туда же за профилем и текстурами. Значит,
 * никто не мешает этим адресом сделать сам лаунчер — и тогда игра получает скин
 * с диска, вообще не выходя в сеть.
 *
 * Что это даёт, кроме офлайна:
 *   — скин появляется сразу, без похода на ely.by при каждом запуске игры;
 *   — недоступность ely.by перестаёт быть событием: раньше агент в этом случае
 *     гасил JVM до старта игры (см. AuthlibInjector.serverReachable) и скина не
 *     было тем более;
 *   — ссылка на текстуру перестаёт быть одноразовой: она всегда одна и та же,
 *     поэтому кэш текстур самого клиента (assets/skins, имя файла — хеш ссылки)
 *     переиспользуется, а не растёт с каждым запуском.
 *
 * Проверено на живом агенте 1.2.8: метаданные без signaturePublickey он
 * принимает, http вместо https тоже, а профиль без подписи доходит до клиента
 * целиком — подпись нужна только для чужих серверов, которым мы не доверяем.
 * Отсюда и решение не возиться с ключами: подпись из кэшированного профиля
 * выбрасывается, потому что после подмены ссылок она всё равно врёт.
 */
public final class AuthlibServer {

    /** Порт веб-сервера лаунчера. Ставит WebServer при старте. */
    private static volatile int port = 0;

    private static final String ROOT = "/authlib";

    public static void bind(int launcherPort) {
        port = launcherPort;
    }

    /** Адрес, который получает агент: он же — корень API. */
    public static String apiRoot() {
        return "http://127.0.0.1:" + port + ROOT;
    }

    public static boolean ready() {
        return port > 0;
    }

    public void handle(HttpExchange ex) throws IOException {
        String path = ex.getRequestURI().getPath();
        if (path == null) path = "";
        if (path.length() > ROOT.length() && path.startsWith(ROOT)) {
            path = path.substring(ROOT.length());
        } else {
            path = "/";
        }

        if (path.equals("/") || path.isEmpty()) {
            text(ex, 200, metadata());
            return;
        }
        if (path.startsWith("/sessionserver/session/minecraft/profile/")) {
            String uuid = path.substring("/sessionserver/session/minecraft/profile/".length());
            byte[] body = profile(uuid);
            if (body == null) { text(ex, 204, ""); return; }
            text(ex, 200, body);
            return;
        }
        if (path.startsWith("/skin/") || path.startsWith("/cape/")) {
            boolean cape = path.startsWith("/cape/");
            String uuid = path.substring(cape ? "/cape/".length() : "/skin/".length());
            if (uuid.endsWith(".png")) uuid = uuid.substring(0, uuid.length() - 4);
            byte[] png = texture(uuid, cape ? GameSkinCache.CAPE : GameSkinCache.SKIN);
            if (png == null) { text(ex, 404, ""); return; }
            ex.getResponseHeaders().set("Content-Type", "image/png");
            text(ex, 200, png);
            return;
        }
        // Прочие адреса протокола (регистрация ключа чата, вход на сервер) нам
        // нечего обслуживать: они требуют настоящего токена, которого у аккаунта
        // ely.by нет и раньше — с агентом на ely.by они точно так же не проходили.
        System.out.println("[authlib] запрос " + path + " — не наш, отвечаю 404");
        text(ex, 404, "");
    }

    /**
     * Метаданные в том виде, в каком их ждёт агент.
     *
     * skinDomains — белый список доменов для ссылок на текстуры: клиент без
     * него отказывается качать скин с localhost. no_mojang_namespace повторяет
     * настройку ely.by: их аккаунты живут не в Mojang, и клиенту незачем туда
     * ходить.
     */
    private String metadata() {
        JsonObject meta = new JsonObject();
        meta.addProperty("serverName", "Ely.by");
        meta.addProperty("implementationName", "pulsePLUS");
        meta.addProperty("implementationVersion", "1.0");
        meta.addProperty("feature.no_mojang_namespace", true);

        JsonArray domains = new JsonArray();
        domains.add("127.0.0.1");
        domains.add("ely.by");
        domains.add(".ely.by");

        JsonObject out = new JsonObject();
        out.add("meta", meta);
        out.add("skinDomains", domains);
        return out.toString();
    }

    /**
     * Профиль игрока со ссылками на наши картинки.
     *
     * Кэшированный ответ ely.by переписывается по минимуму: меняются только
     * адреса SKIN и CAPE, всё остальное — ник, UUID, признак slim-модели —
     * остаётся как есть. Подпись снимается: после подмены адреса она не сходится,
     * а неподписанный профиль клиент принимает (проверено на агенте 1.2.8).
     */
    private byte[] profile(String uuidText) {
        Path file = GameSkinCache.profileFile(uuidText);
        if (file == null || !Files.isRegularFile(file)) return null;

        try {
            JsonObject o = JsonParser.parseString(
                    Files.readString(file, StandardCharsets.UTF_8)).getAsJsonObject();
            for (JsonElement el : o.getAsJsonArray("properties")) {
                JsonObject prop = el.getAsJsonObject();
                if (!"textures".equals(prop.get("name").getAsString())) continue;
                JsonObject tex = JsonParser.parseString(new String(
                        Base64.getDecoder().decode(prop.get("value").getAsString()),
                        StandardCharsets.UTF_8)).getAsJsonObject();
                JsonObject textures = tex.getAsJsonObject("textures");
                if (textures == null) continue;

                boolean changed = false;
                for (String kind : new String[]{GameSkinCache.SKIN, GameSkinCache.CAPE}) {
                    if (!textures.has(kind)) continue;
                    if (GameSkinCache.texture(uuidText, kind) == null) {
                        // Картинки нет — обещать её клиенту нельзя, иначе он
                        // будет ждать загрузки, которой не бывает
                        textures.remove(kind);
                        changed = true;
                        continue;
                    }
                    String path = GameSkinCache.CAPE.equals(kind) ? "/cape/" : "/skin/";
                    textures.getAsJsonObject(kind).addProperty("url",
                            apiRoot() + path + GameSkinCache.key(uuidText) + ".png");
                    changed = true;
                }
                if (changed) {
                    prop.addProperty("value", Base64.getEncoder().encodeToString(
                            tex.toString().getBytes(StandardCharsets.UTF_8)));
                    prop.remove("signature");
                }
            }
            System.out.println("[authlib] профиль " + o.get("name").getAsString() + " отдан");
            return o.toString().getBytes(StandardCharsets.UTF_8);
        } catch (Exception e) {
            System.out.println("[authlib] профиль не собрался: " + e.getMessage());
            return null;
        }
    }

    private byte[] texture(String uuidText, String kind) {
        Path p = GameSkinCache.texture(uuidText, kind);
        if (p == null) return null;
        try {
            return Files.readAllBytes(p);
        } catch (Exception e) {
            return null;
        }
    }

    private void text(HttpExchange ex, int code, String body) throws IOException {
        text(ex, code, body.getBytes(StandardCharsets.UTF_8));
    }

    private void text(HttpExchange ex, int code, byte[] body) throws IOException {
        if (body.length == 0) {
            ex.sendResponseHeaders(code, -1);
            ex.close();
            return;
        }
        if (ex.getResponseHeaders().getFirst("Content-Type") == null) {
            ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        }
        ex.sendResponseHeaders(code, body.length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(body);
        }
    }
}
