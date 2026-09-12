package launcher.auth;

/**
 * Одна учётная запись лаунчера.
 *
 * Два вида:
 *   offline — просто ник, UUID выводится из него детерминированно, токена нет;
 *   msa     — вход Microsoft, есть refresh-токен, настоящие UUID, ник и XUID.
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
