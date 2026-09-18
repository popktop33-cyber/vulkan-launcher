package launcher.auth;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * Кто есть кто на ely.by — единственное, что лаунчеру нужно знать про их API
 * сверх системы скинов.
 *
 * UUID у ely.by свой собственный и с ником никак не связан:
 *
 *     propadar              → 96a88b934c9342eab9c26ce9120b0350   (ely.by)
 *     md5("OfflinePlayer:propadar") → f6a0108c28bd3a4aa7409b47d4603a27
 *
 * Разница не косметическая. Игровой клиент спрашивает текстуры по UUID, и по
 * офлайн-значению ely.by отвечает 204 — «нет такого игрока», скин не приезжает
 * даже при подключённом authlib-injector. Раньше лаунчер писал в аккаунт именно
 * офлайн-значение (см. AccountStore.addElyby), потому что ник и UUID казались
 * взаимозаменяемыми. Это было неверно.
 */
public final class ElybyProfile {

    private static final String API = "https://authserver.ely.by/api/users/profiles/minecraft/";
    private static final String UA = "vulkan-launcher/2.0";
    private static final int TIMEOUT = 8000;

    private ElybyProfile() {}

    /**
     * Настоящий UUID игрока либо null, если ник не найден или сети нет.
     *
     * Именно null, а не исключение: вызывающий код вправе откатиться на
     * офлайн-значение и запустить игру — скин хуже, чем отказ запуска, но
     * зависеть от доступности ely.by запуск не должен.
     */
    public static String uuidOf(String nick) {
        if (nick == null || nick.isBlank()) return null;
        HttpURLConnection c = null;
        try {
            String url = API + URLEncoder.encode(nick, StandardCharsets.UTF_8);
            c = (HttpURLConnection) URI.create(url).toURL().openConnection();
            c.setConnectTimeout(TIMEOUT);
            c.setReadTimeout(TIMEOUT);
            c.setRequestProperty("User-Agent", UA);
            if (c.getResponseCode() != 200) return null;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (InputStream in = c.getInputStream()) {
                in.transferTo(out);
            }
            JsonObject o = JsonParser.parseString(out.toString(StandardCharsets.UTF_8)).getAsJsonObject();
            if (!o.has("id")) return null;      // 404 у них приходит в том же конверте
            String id = o.get("id").getAsString().trim();
            return id.isEmpty() ? null : id;
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
