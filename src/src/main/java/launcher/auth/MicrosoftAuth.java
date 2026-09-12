package launcher.auth;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Вход в Microsoft по device-code flow.
 *
 * Цепочка ровно та же, что у официального лаунчера:
 *   Microsoft (device code) → Xbox Live → XSTS → api.minecraftservices.com → профиль.
 *
 * Client ID — публичный клиент Azure, секрет не нужен и не должен использоваться.
 * Он вводится пользователем в настройках и лежит в config.json.
 *
 * Токен доступа Minecraft живёт около суток; в файл кладётся только refresh-токен,
 * из которого токен добывается заново при запуске.
 */
public class MicrosoftAuth {
    private static final HttpClient HTTP = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(20))
        .followRedirects(HttpClient.Redirect.NORMAL)
        .build();
    private static final Gson GSON = new Gson();

    private static final String DEVICE_CODE_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
    private static final String TOKEN_URL       = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
    private static final String XBL_URL         = "https://user.auth.xboxlive.com/user/authenticate";
    private static final String XSTS_URL        = "https://xsts.auth.xboxlive.com/xsts/authorize";
    private static final String MC_LOGIN_URL    = "https://api.minecraftservices.com/authentication/login_with_xbox";
    private static final String MC_PROFILE_URL  = "https://api.minecraftservices.com/minecraft/profile";
    private static final String SCOPE           = "XboxLive.signin offline_access";

    /** Ошибка с текстом, который не стыдно показать пользователю. */
    public static class AuthError extends Exception {
        public AuthError(String message) { super(message); }
    }

    /** Пользователь ещё не подтвердил вход — это не ошибка, надо просто опросить снова. */
    public static class Pending extends Exception {
        public Pending() { super("authorization_pending"); }
    }

    public static class DeviceCode {
        public String deviceCode = "";
        public String userCode = "";
        public String verificationUri = "";
        public String message = "";
        public int intervalSeconds = 5;
        public long expiresAt = 0L;
    }

    public static class AuthResult {
        public Account account;
        public String accessToken = "";
        public long expiresAt = 0L;
    }

    // ── Шаг 1: получить код ─────────────────────────────────────────────────

    public static DeviceCode start(String clientId) throws AuthError {
        if (clientId == null || clientId.isBlank()) {
            throw new AuthError("Сначала впиши Client ID приложения Azure в настройках");
        }
        Map<String, String> form = new LinkedHashMap<>();
        form.put("client_id", clientId.trim());
        form.put("scope", SCOPE);

        JsonObject json = postForm(DEVICE_CODE_URL, form, null);
        DeviceCode dc = new DeviceCode();
        dc.deviceCode = str(json, "device_code");
        dc.userCode = str(json, "user_code");
        dc.verificationUri = str(json, "verification_uri");
        dc.message = str(json, "message");
        dc.intervalSeconds = json.has("interval") ? json.get("interval").getAsInt() : 5;
        long expiresIn = json.has("expires_in") ? json.get("expires_in").getAsLong() : 900L;
        dc.expiresAt = System.currentTimeMillis() + expiresIn * 1000L;
        if (dc.deviceCode.isBlank() || dc.userCode.isBlank()) {
            throw new AuthError("Microsoft не выдал код устройства. Проверь Client ID.");
        }
        return dc;
    }

    // ── Шаг 2: дождаться подтверждения ──────────────────────────────────────

    public static AuthResult poll(String clientId, DeviceCode dc) throws AuthError, Pending {
        if (System.currentTimeMillis() > dc.expiresAt) {
            throw new AuthError("Код истёк — начни вход заново");
        }
        Map<String, String> form = new LinkedHashMap<>();
        form.put("client_id", clientId.trim());
        form.put("grant_type", "urn:ietf:params:oauth:grant-type:device_code");
        form.put("device_code", dc.deviceCode);

        JsonObject json = postFormAllowError(TOKEN_URL, form);
        if (json.has("error")) {
            String err = json.get("error").getAsString();
            switch (err) {
                case "authorization_pending": throw new Pending();
                case "slow_down":             throw new Pending();
                case "expired_token":         throw new AuthError("Код истёк — начни вход заново");
                case "authorization_declined":throw new AuthError("Вход отменён в браузере");
                case "bad_verification_code": throw new AuthError("Код не принят, начни вход заново");
                default:
                    throw new AuthError("Microsoft ответил ошибкой: " + err
                        + (json.has("error_description") ? " — " + str(json, "error_description") : ""));
            }
        }
        return finishLogin(str(json, "access_token"), str(json, "refresh_token"));
    }

    // ── Тихий повторный вход по refresh-токену ──────────────────────────────

    public static AuthResult refresh(String clientId, Account account) throws AuthError {
        if (account == null || account.refreshToken == null || account.refreshToken.isBlank()) {
            throw new AuthError("Нет сохранённого входа — войди в Microsoft заново");
        }
        Map<String, String> form = new LinkedHashMap<>();
        form.put("client_id", clientId.trim());
        form.put("grant_type", "refresh_token");
        form.put("refresh_token", account.refreshToken);
        form.put("scope", SCOPE);

        JsonObject json = postFormAllowError(TOKEN_URL, form);
        if (json.has("error")) {
            throw new AuthError("Сессия Microsoft истекла — войди заново");
        }
        return finishLogin(str(json, "access_token"), str(json, "refresh_token"));
    }

    // ── Общая часть: Xbox Live → XSTS → Minecraft ──────────────────────────

    private static AuthResult finishLogin(String msaToken, String refreshToken) throws AuthError {
        if (msaToken.isBlank()) throw new AuthError("Microsoft не вернул токен доступа");

        // Xbox Live
        JsonObject xblProps = new JsonObject();
        xblProps.addProperty("AuthMethod", "RPS");
        xblProps.addProperty("SiteName", "user.auth.xboxlive.com");
        xblProps.addProperty("RpsTicket", "d=" + msaToken);
        JsonObject xblBody = new JsonObject();
        xblBody.add("Properties", xblProps);
        xblBody.addProperty("RelyingParty", "http://auth.xboxlive.com");
        xblBody.addProperty("TokenType", "JWT");

        JsonObject xbl = postJson(XBL_URL, xblBody, null);
        String xblToken = str(xbl, "Token");
        String uhs = claim(xbl, "uhs");
        if (xblToken.isBlank()) throw new AuthError("Xbox Live не принял вход");

        // XSTS
        JsonObject xstsProps = new JsonObject();
        xstsProps.addProperty("SandboxId", "RETAIL");
        JsonArray tokens = new JsonArray();
        tokens.add(xblToken);
        xstsProps.add("UserTokens", tokens);
        JsonObject xstsBody = new JsonObject();
        xstsBody.add("Properties", xstsProps);
        xstsBody.addProperty("RelyingParty", "rp://api.minecraftservices.com/");
        xstsBody.addProperty("TokenType", "JWT");

        JsonObject xsts = postJson(XSTS_URL, xstsBody, null);
        String xstsToken = str(xsts, "Token");
        if (xstsToken.isBlank()) throw new AuthError(xstsErrorMessage(xsts));
        String uhsFinal = claim(xsts, "uhs");
        String xuid = claim(xsts, "xid");
        if (uhsFinal.isBlank()) uhsFinal = uhs;

        // Minecraft
        JsonObject mcBody = new JsonObject();
        mcBody.addProperty("identityToken", "XBL3.0 x=" + uhsFinal + ";" + xstsToken);
        JsonObject mc = postJson(MC_LOGIN_URL, mcBody, null);
        String mcToken = str(mc, "access_token");
        if (mcToken.isBlank()) throw new AuthError("Minecraft не принял вход Xbox");
        long expiresIn = mc.has("expires_in") ? mc.get("expires_in").getAsLong() : 86400L;

        // Профиль
        JsonObject profile = getJson(MC_PROFILE_URL, mcToken);
        String name = str(profile, "name");
        String uuid = str(profile, "id");
        if (name.isBlank() || uuid.isBlank()) {
            throw new AuthError("У этого аккаунта нет Minecraft: Java Edition");
        }

        Account account = AccountStore.get().putMicrosoft(name, uuid, refreshToken, xuid);

        AuthResult result = new AuthResult();
        result.account = account;
        result.accessToken = mcToken;
        // Небольшой запас, чтобы токен не истёк посреди запуска игры
        result.expiresAt = System.currentTimeMillis() + expiresIn * 1000L - 60_000L;
        return result;
    }

    /**
     * XSTS отвечает 401 с числовым XErr — переводим самые частые случаи.
     * Коды больше 2^31, поэтому сравнения, а не switch: по long Java не переключает,
     * а в int эти значения не влезают.
     */
    private static String xstsErrorMessage(JsonObject xsts) {
        if (!xsts.has("XErr")) return "Xbox не авторизовал вход";
        long code = xsts.get("XErr").getAsLong();
        if (code == 2148916233L) {
            return "У этого аккаунта Microsoft нет профиля Xbox. Создай его на xbox.com и повтори вход.";
        }
        if (code == 2148916235L) {
            return "Xbox Live недоступен в этой стране.";
        }
        if (code == 2148916238L) {
            return "Аккаунт несовершеннолетний: его должен добавить в семейную группу взрослый.";
        }
        return "Xbox вернул ошибку " + code;
    }

    // ── HTTP ────────────────────────────────────────────────────────────────

    private static String formEncode(Map<String, String> form) {
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String> e : form.entrySet()) {
            if (sb.length() > 0) sb.append('&');
            sb.append(URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8))
              .append('=')
              .append(URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8));
        }
        return sb.toString();
    }

    private static JsonObject postForm(String url, Map<String, String> form, String bearer) throws AuthError {
        JsonObject json = postFormAllowError(url, form, bearer);
        if (json.has("error")) {
            throw new AuthError(str(json, "error_description").isBlank()
                ? str(json, "error") : str(json, "error_description"));
        }
        return json;
    }

    private static JsonObject postFormAllowError(String url, Map<String, String> form) throws AuthError {
        return postFormAllowError(url, form, null);
    }

    private static JsonObject postFormAllowError(String url, Map<String, String> form, String bearer) throws AuthError {
        try {
            HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(30))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .header("Accept", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(formEncode(form), StandardCharsets.UTF_8));
            if (bearer != null && !bearer.isBlank()) b.header("Authorization", "Bearer " + bearer);
            HttpResponse<String> res = HTTP.send(b.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            return JsonParser.parseString(res.body()).getAsJsonObject();
        } catch (Exception e) {
            throw new AuthError("Не удалось связаться с Microsoft: " + e.getMessage());
        }
    }

    private static JsonObject postJson(String url, JsonObject body, String bearer) throws AuthError {
        try {
            HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(30))
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .header("x-xbl-contract-version", "1")
                .POST(HttpRequest.BodyPublishers.ofString(GSON.toJson(body), StandardCharsets.UTF_8));
            if (bearer != null && !bearer.isBlank()) b.header("Authorization", "Bearer " + bearer);
            HttpResponse<String> res = HTTP.send(b.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            String text = res.body();
            if (text == null || text.isBlank()) return new JsonObject();
            return JsonParser.parseString(text).getAsJsonObject();
        } catch (Exception e) {
            throw new AuthError("Ошибка обращения к " + hostOf(url) + ": " + e.getMessage());
        }
    }

    private static JsonObject getJson(String url, String bearer) throws AuthError {
        try {
            HttpResponse<String> res = HTTP.send(
                HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(30))
                    .header("Accept", "application/json")
                    .header("Authorization", "Bearer " + bearer)
                    .GET().build(),
                HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            String text = res.body();
            if (text == null || text.isBlank()) return new JsonObject();
            return JsonParser.parseString(text).getAsJsonObject();
        } catch (Exception e) {
            throw new AuthError("Ошибка обращения к " + hostOf(url) + ": " + e.getMessage());
        }
    }

    private static String hostOf(String url) {
        try { return URI.create(url).getHost(); } catch (Exception e) { return url; }
    }

    private static String str(JsonObject o, String key) {
        if (o == null || !o.has(key) || o.get(key).isJsonNull()) return "";
        JsonElement e = o.get(key);
        try { return e.getAsString(); } catch (Exception ex) { return String.valueOf(e); }
    }

    /** Достаёт DisplayClaims.xui[0].<key> из ответов Xbox. */
    private static String claim(JsonObject o, String key) {
        try {
            return o.getAsJsonObject("DisplayClaims").getAsJsonArray("xui")
                    .get(0).getAsJsonObject().get(key).getAsString();
        } catch (Exception e) {
            return "";
        }
    }
}
