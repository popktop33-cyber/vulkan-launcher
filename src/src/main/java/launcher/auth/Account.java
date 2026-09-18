package launcher.auth;

/**
 * Одна учётная запись лаунчера.
 *
 * Три вида:
 *   offline — просто ник, UUID выводится из него детерминированно, токена нет;
 *   msa     — вход Microsoft, есть refresh-токен, настоящие UUID, ник и XUID;
 *   elyby   — ник, подтверждённый входом на ely.by. Токена нет и он не нужен:
 *             скин и плащ лаунчер тянет по нику через SkinService, а вход
 *             живёт в партиции Chromium (см. elyby-state и elyby-wear в
 *             installer/main.js). Игре такой аккаунт отдаётся как legacy —
 *             ровно так же, как офлайн-профиль, потому что проверять ник
 *             на стороне игры лаунчер не умеет; скин при этом подхватывается,
 *             если клиент настроен на ely.by.
 *
 * Токен доступа Minecraft живёт около суток и в файле не хранится: он берётся
 * из refresh-токена при запуске и держится только в памяти (см. Session).
 */
public class Account {
    public String id = "";
    public String type = "offline";
    public String name = "Player";
    public String uuid = "";
    public String refreshToken = "";
    public String xuid = "";
    public long lastLogin = 0L;

    public boolean isMicrosoft() {
        return "msa".equals(type);
    }

    public boolean isElyby() {
        return "elyby".equals(type);
    }

    /** Тип, который ждёт аргумент --userType в игре. */
    public String userType() {
        return isMicrosoft() ? "msa" : "legacy";
    }

    public String initial() {
        String n = name == null ? "" : name.trim();
        return n.isEmpty() ? "?" : n.substring(0, 1).toUpperCase();
    }

    /** Копия для отдачи в интерфейс: refresh-токен наружу не отдаём. */
    public Account publicCopy() {
        Account a = new Account();
        a.id = id;
        a.type = type;
        a.name = name;
        a.uuid = uuid;
        a.xuid = xuid;
        a.lastLogin = lastLogin;
        return a;
    }
}
