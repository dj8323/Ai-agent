package com.telemune.smartai.api;

import com.telemune.smartai.service.LogService;
import com.telemune.smartai.util.J;
import com.telemune.smartai.web.ApiException;
import com.telemune.smartai.web.Ctx;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * SuperAdmin only (ApiFilter checks role 0): the backend's server files (.env, keys.env) and a restart.
 * Secret values are never sent to the browser: they come back as {set: true} and are only replaced when a new value is typed.
 * Every save keeps a copy of the old file in config-backups/ (gitignored). Changes apply after a restart.
 */
@RestController
@RequestMapping("/api/super")
public class SuperController {
  private static final Logger log = LoggerFactory.getLogger(SuperController.class);
  private static final List<String> FILES = List.of(".env", "keys.env");
  private static final Pattern KEY = Pattern.compile("^[A-Za-z0-9_.\\-]{1,80}$");
  private static final Pattern SECRET = Pattern.compile("(?i).*(pass|secret|key|token|credential|private).*");

  private final Path home;
  private final LogService logs;

  public SuperController(@Value("${app.home}") String home, LogService logs) {
    this.home = Path.of(home).toAbsolutePath().normalize();
    this.logs = logs;
  }

  static boolean secret(String key) {
    return SECRET.matcher(key).matches() && !key.matches("(?i).*(_PORT|_HOST|_USER|_DATABASE|region|enabled|template.*|header|params|path|url)$");
  }

  /** Both files as [{file, entries:[{key, value | set, secret, comment}]}] in file order. */
  @GetMapping("/server-config")
  Map<String, Object> read() throws IOException {
    List<Map<String, Object>> out = new ArrayList<>();
    for (String f : FILES) {
      Path p = home.resolve(f);
      List<Map<String, Object>> entries = new ArrayList<>();
      String comment = "";
      if (Files.exists(p)) {
        for (String line : Files.readAllLines(p, StandardCharsets.UTF_8)) {
          String t = line.trim();
          if (t.startsWith("#")) { comment = t.replaceFirst("^#+\\s*", ""); continue; }
          int eq = t.indexOf('=');
          if (t.isEmpty() || eq <= 0) { comment = ""; continue; }
          String key = t.substring(0, eq).trim(), value = t.substring(eq + 1).trim();
          boolean s = secret(key);
          Map<String, Object> e = J.map("key", key, "secret", s, "comment", comment);
          if (s) e.put("set", !value.isEmpty()); else e.put("value", value);
          entries.add(e);
          comment = "";
        }
      }
      out.add(J.map("file", f, "exists", Files.exists(p), "entries", entries));
    }
    return J.map("files", out, "home", home.toString());
  }

  /** Body {file, changes:{KEY: value}}: changed and new keys are written in place (comments kept); a copy of the old file is kept. */
  @PutMapping("/server-config")
  Map<String, Object> write(@RequestBody Map<String, Object> body, @RequestAttribute("ctx") Ctx ctx) throws IOException {
    String f = J.str(body.get("file"));
    if (!FILES.contains(f)) throw ApiException.bad("Unknown file.");
    Map<String, Object> changes = J.obj(body.get("changes"));
    if (changes.isEmpty()) return J.map("ok", true, "changed", List.of());
    for (Map.Entry<String, Object> c : changes.entrySet()) {
      if (!KEY.matcher(c.getKey()).matches()) throw ApiException.bad("Bad setting name: " + c.getKey());
      if (String.valueOf(c.getValue()).matches("(?s).*[\\r\\n].*")) throw ApiException.bad("Values can't contain line breaks (" + c.getKey() + ").");
    }
    Path p = home.resolve(f);
    List<String> lines = Files.exists(p) ? new ArrayList<>(Files.readAllLines(p, StandardCharsets.UTF_8)) : new ArrayList<>();
    if (Files.exists(p)) { // keep the old file
      Path dir = home.resolve("config-backups");
      Files.createDirectories(dir);
      Files.copy(p, dir.resolve(f.replace(".", "") + "-" + LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss"))));
    }
    Map<String, Object> left = new LinkedHashMap<>(changes);
    for (int i = 0; i < lines.size(); i++) {
      String t = lines.get(i).trim();
      int eq = t.indexOf('=');
      if (t.startsWith("#") || eq <= 0) continue;
      String key = t.substring(0, eq).trim();
      if (left.containsKey(key)) lines.set(i, key + "=" + String.valueOf(left.remove(key)).trim());
    }
    for (Map.Entry<String, Object> c : left.entrySet()) lines.add(c.getKey() + "=" + String.valueOf(c.getValue()).trim());
    Files.write(p, (String.join("\n", lines) + "\n").getBytes(StandardCharsets.UTF_8));
    try { p.toFile().setReadable(false, false); p.toFile().setReadable(true, true); p.toFile().setWritable(false, false); p.toFile().setWritable(true, true); } catch (Exception ignored) { }
    List<String> names = new ArrayList<>(changes.keySet());
    log.info("Server config {} changed by {}: {}", f, ctx.username(), names); // names only, never values
    logs.activity(ctx, "server.config", f, J.map("keys", names));
    return J.map("ok", true, "changed", names, "restartNeeded", true);
  }

  /**
   * Restarts the backend: starts ./run.sh in the background (it stops this copy, rebuilds if the code changed, and starts a
   * fresh one with the new settings), then answers. The web app keeps running; the page waits for /api/health.
   */
  @PostMapping("/restart")
  ResponseEntity<Map<String, Object>> restart(@RequestAttribute("ctx") Ctx ctx) throws IOException {
    File run = home.resolve("run.sh").toFile();
    if (!run.canExecute()) throw ApiException.bad("run.sh wasn't found next to the backend, so it can't restart itself. Restart it from its terminal.");
    Files.createDirectories(home.resolve("logs"));
    logs.activity(ctx, "server.restart", "backend", null);
    log.warn("Restart requested by {}", ctx.username());
    new ProcessBuilder("/bin/bash", "-c", "sleep 1; exec nohup ./run.sh")
        .directory(home.toFile())
        .redirectOutput(ProcessBuilder.Redirect.appendTo(home.resolve("logs/restart.log").toFile()))
        .redirectErrorStream(true)
        .redirectInput(ProcessBuilder.Redirect.from(new File("/dev/null")))
        .start();
    return ResponseEntity.accepted().body(J.map("ok", true, "message", "Restarting. The backend is back in about 10–20 seconds."));
  }
}
