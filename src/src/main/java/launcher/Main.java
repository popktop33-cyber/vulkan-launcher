package launcher;

import launcher.web.WebServer;
import java.nio.file.*;

public class Main {
    public static void main(String[] args) throws Exception {
        boolean serverMode = false;
        for (String arg : args) {
            if ("--server".equals(arg)) { serverMode = true; break; }
        }

        Files.createDirectories(LauncherConfig.dataDir().resolve("minecraft").resolve("mods"));
        Files.createDirectories(LauncherConfig.vanillaGameDir());

        WebServer server = new WebServer(47820);
        server.start();
        System.out.println("[pulsePLUS] Backend started on port 47820");

        if (!serverMode) {
            try {
                java.awt.Desktop.getDesktop().browse(new java.net.URI("http://127.0.0.1:47820/"));
            } catch (Exception ignored) {}
        }

        Thread.currentThread().join();
    }
}
