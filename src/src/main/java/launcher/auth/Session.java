package launcher.auth;

import launcher.LauncherConfig;

/**
 * Учётные данные для запуска игры по активному аккаунту.
 *
 * Токен доступа Minecraft живёт около суток, поэтому он держится в памяти и
 * обновляется из refresh-токена по истечении. В файле лежит только refresh-токен.
 *
 * Если обновить вход не удалось, запуск не подменяется тихо офлайном — летит
 * исключение с понятным текстом, чтобы интерфейс попросил войти заново.
 */
public class Session {
    public String name = "Player";
    public String uuid = "";
    public String accessToken = "0";
    public String xuid = "";
    public String userType = "legacy";
    /**
     * Аккаунт ely.by — игре к нему нужен javaagent authlib-injector, иначе скин
     * не появится нигде: клиент уходит за текстурами на Mojang.
     */
    public boolean elyby = false;

    private static String cachedToken = "";
    private static long cachedExpiresAt = 0L;
    private static String cachedAccountId = "";

    public static Session forActive(LauncherConfig cfg) throws Exception {
        AccountStore store = AccountStore.get();
        Account account = store.active();
        Session session = new Session();

        if (account == null) {
            session.uuid = AccountStore.offlineUuid(session.name);
            return session;
        }

        if (!account.isMicrosoft()) {
            session.name = account.name;
            // Профиль ely.by: клиенту нужен ИХ UUID, иначе он не найдёт текстуры,
            // а запуску — javaagent authlib-injector, иначе он пойдёт за ними на
            // Mojang (см. AuthlibInjector). Профили, заведённые до этой правки,
            // хранят офлайн-значение — чиним здесь, один раз.
            if (account.isElyby()) {
                AccountStore.get().ensureElybyUuid(account);
                session.elyby = true;
            }
            session.uuid = (account.uuid == null || account.uuid.isBlank())
                ? AccountStore.offlineUuid(account.name)
                : account.uuid;
            return session;
        }

        String token;
        synchronized (Session.class) {
            if (account.id.equals(cachedAccountId)
                    && !cachedToken.isEmpty()
                    && System.currentTimeMillis() < cachedExpiresAt) {
                token = cachedToken;
            } else {
                MicrosoftAuth.AuthResult result = MicrosoftAuth.refresh(cfg.msaClientId, account);
                cachedToken = result.accessToken;
                cachedExpiresAt = result.expiresAt;
                cachedAccountId = account.id;
                account = result.account;
                token = result.accessToken;
            }
        }

        session.name = account.name;
        session.uuid = account.uuid;
        session.accessToken = token;
        session.xuid = account.xuid == null ? "" : account.xuid;
        session.userType = "msa";
        return session;
    }

    /** Сбросить кэш токена — после выхода из аккаунта или смены активного. */
    public static synchronized void invalidate() {
        cachedToken = "";
        cachedExpiresAt = 0L;
        cachedAccountId = "";
    }
}
