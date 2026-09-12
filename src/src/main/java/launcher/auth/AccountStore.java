package launcher.auth;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import launcher.LauncherConfig;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Список учётных записей и выбранная сейчас.
 *
 * Лежит в %APPDATA%/pulsePLUS/accounts.json. Старое единственное имя из
 * config.json переезжает в первый офлайн-аккаунт при первом чтении, чтобы
 * у существующих пользователей ничего не потерялось.
 */
public class AccountStore {
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static final Path FILE = LauncherConfig.dataDir().resolve("accounts.json");
    private static AccountStore instance;

    private final List<Account> accounts = new ArrayList<>();
    private String activeId = "";

    public static synchronized AccountStore get() {
        if (instance == null) {
            instance = load();
            instance.ensureUsable();
        }
        return instance;
    }

    // ── Чтение ──────────────────────────────────────────────────────────────

    public synchronized List<Account> all() {
        return new ArrayList<>(accounts);
    }

    public synchronized Account active() {
        for (Account a : accounts) {
            if (a.id.equals(activeId)) return a;
        }
        return accounts.isEmpty() ? null : accounts.get(0);
    }

    public synchronized Account byId(String id) {
        for (Account a : accounts) {
            if (a.id.equals(id)) return a;
        }
        return null;
    }

    // ── Изменение ───────────────────────────────────────────────────────────

    public synchronized void select(String id) {
        if (byId(id) == null) return;
        activeId = id;
        Account a = byId(id);
        if (a != null) a.lastLogin = System.currentTimeMillis();
        save();
    }

    /** Добавить офлайн-аккаунт. Повторяющийся ник возвращает уже существующий. */
    public synchronized Account addOffline(String rawName) {
        String name = sanitizeName(rawName);
        for (Account a : accounts) {
            if (!a.isMicrosoft() && a.name.equalsIgnoreCase(name)) {
                activeId = a.id;
                save();
                return a;
            }
        }
        Account a = new Account();
        a.id = UUID.randomUUID().toString();
        a.type = "offline";
        a.name = name;
        a.uuid = offlineUuid(name);
        a.lastLogin = System.currentTimeMillis();
        accounts.add(a);
        activeId = a.id;
        save();
        return a;
    }

    /** Добавить или обновить аккаунт Microsoft, полученный после входа. */
    public synchronized Account putMicrosoft(String name, String uuid, String refreshToken, String xuid) {
        Account found = null;
        for (Account a : accounts) {
            if (a.isMicrosoft() && (a.uuid.equalsIgnoreCase(uuid) || a.name.equalsIgnoreCase(name))) {
                found = a;
                break;
            }
        }
        if (found == null) {
            found = new Account();
            found.id = UUID.randomUUID().toString();
            found.type = "msa";
            accounts.add(found);
        }
        found.name = name;
        found.uuid = uuid;
        found.refreshToken = refreshToken;
        found.xuid = xuid;
        found.lastLogin = System.currentTimeMillis();
        activeId = found.id;
        save();
        return found;
    }

    public synchronized void remove(String id) {
        accounts.removeIf(a -> a.id.equals(id));
        if (id.equals(activeId)) {
            activeId = accounts.isEmpty() ? "" : accounts.get(0).id;
        }
        ensureUsable();
        save();
    }

    // ── Служебное ───────────────────────────────────────────────────────────

    /** Ник как в игре: 3–16 символов, буквы, цифры и подчёркивание. */
    public static String sanitizeName(String raw) {
        String name = raw == null ? "" : raw.trim().replaceAll("[^A-Za-z0-9_]", "");
        if (name.length() > 16) name = name.substring(0, 16);
        if (name.length() < 3) name = "Player";
        return name;
    }

    /** Детерминированный офлайн-UUID — тот же алгоритм, что и в MinecraftLauncher. */
    public static String offlineUuid(String name) {
        return UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(StandardCharsets.UTF_8))
                   .toString().replace("-", "");
    }

    /** Список никогда не должен остаться пустым: без аккаунта игра не запустится. */
    private void ensureUsable() {
        if (!accounts.isEmpty()) {
            if (byId(activeId) == null) activeId = accounts.get(0).id;
            return;
        }
        String legacy = LauncherConfig.get().userName;
        Account a = new Account();
        a.id = UUID.randomUUID().toString();
        a.type = "offline";
        a.name = sanitizeName(legacy);
        a.uuid = offlineUuid(a.name);
        accounts.add(a);
        activeId = a.id;
        save();
    }

    private static AccountStore load() {
        AccountStore store = new AccountStore();
        if (!Files.exists(FILE)) return store;
        try (BufferedReader r = Files.newBufferedReader(FILE, StandardCharsets.UTF_8)) {
            JsonObject root = JsonParser.parseReader(r).getAsJsonObject();
            if (root.has("activeId")) store.activeId = root.get("activeId").getAsString();
            if (root.has("accounts")) {
                JsonArray arr = root.getAsJsonArray("accounts");
                for (int i = 0; i < arr.size(); i++) {
                    Account a = GSON.fromJson(arr.get(i), Account.class);
                    if (a != null && a.id != null && !a.id.isBlank()) store.accounts.add(a);
                }
            }
        } catch (Exception ignored) {
            // Битый файл не должен мешать запуску — начнём список заново
        }
        return store;
    }

    public synchronized void save() {
        try {
            JsonObject root = new JsonObject();
            root.addProperty("activeId", activeId);
            JsonArray arr = new JsonArray();
            for (Account a : accounts) arr.add(GSON.toJsonTree(a));
            root.add("accounts", arr);
            Files.createDirectories(FILE.getParent());
            try (BufferedWriter w = Files.newBufferedWriter(FILE, StandardCharsets.UTF_8)) {
                GSON.toJson(root, w);
            }
        } catch (Exception ignored) {
        }
    }
}
