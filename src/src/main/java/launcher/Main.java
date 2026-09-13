package launcher;

import launcher.web.WebServer;
import java.nio.file.*;

public class Main {
    public static void main(String[] args) throws Exception {
        boolean serverMode = false;
        // Порт можно переопределить: это нужно, чтобы поднять вторую копию
        // бэкенда рядом с уже запущенным лаунчером и проверить правки, не
        // закрывая его и не пересобирая установщик.
        int port = 47820;
        for (int i = 0; i < args.length; i++) {
            if ("--server".equals(args[i])) {
                serverMode = true;
            } else if ("--port".equals(args[i]) && i + 1 < args.length) {
                port = Integer.parseInt(args[++i]);
            }
        }

        Files.createDirectories(LauncherConfig.dataDir().resolve("minecraft").resolve("mods"));
        Files.createDirectories(LauncherConfig.vanillaGameDir());

        WebServer server = new WebServer(port);
        server.start();
        System.out.println("[pulsePLUS] Backend started on port " + port);

        if (!serverMode) {
            try {
                java.awt.Desktop.getDesktop().browse(new java.net.URI("http://127.0.0.1:" + port + "/"));
            } catch (Exception ignored) {}
        }

        Thread.currentThread().join();
    }
}
