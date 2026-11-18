package com.telemune.smartai.service;

import com.telemune.smartai.db.Db;
import com.telemune.smartai.util.J;
import com.telemune.smartai.web.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * App settings. Layers, last wins:
 * defaults.json ← MySQL app_config (shared settings, one JSON per section) ← the active agent's own setup ← env overrides.
 * config.json (project folder) only seeds app_config on first start.
 * Env overrides (optional): OPENAI_MODEL, OPENAI_TTS_MODEL, OPENAI_REASONING_EFFORT.
 */
@Service
public class AppConfigService {
  private static final Logger log = LoggerFactory.getLogger(AppConfigService.class);
  private final Db db;
  private final Environment env;
  private final Path home;
  private final Map<String, Object> defaults;
  public final List<String> sections;

  private volatile Map<String, Object> cache;
  private volatile long cacheAt;

  public AppConfigService(Db db, Environment env, @Value("${app.home}") String home) throws Exception {
    this.db = db;
    this.env = env;
    this.home = Path.of(home).toAbsolutePath().normalize();
    this.defaults = J.readMap(new String(new ClassPathResource("defaults.json").getInputStream().readAllBytes(), StandardCharsets.UTF_8));
    this.sections = new ArrayList<>(defaults.keySet());
  }

  public Path home() {
    return home;
  }

  private Map<String, Object> readConfigFile() {
    Path f = home.resolve("config.json");
    if (!Files.exists(f)) return new LinkedHashMap<>();
    try {
      return J.readMap(Files.readString(f));
    } catch (Exception e) {
      log.warn("config.json is invalid, using defaults: {}", e.getMessage());
      return new LinkedHashMap<>();
    }
  }

  /** First start: copy config.json (over defaults) into app_config for any section that isn't there yet. */
  public void seed() {
    Map<String, Object> seed = J.merge(defaults, readConfigFile());
    for (String s : sections) db.exec("INSERT IGNORE INTO app_config (section, value) VALUES (?, ?)", s, J.json(seed.get(s)));
    invalidate();
  }

  public void invalidate() {
    cache = null;
  }

  /** Shared settings (cached for 3 s; writes clear the cache). Returns a fresh copy the caller may change. */
  public Map<String, Object> app() {
    Map<String, Object> c = cache;
    if (c == null || System.currentTimeMillis() - cacheAt > 3000) {
      Map<String, Object> fromDb = new LinkedHashMap<>();
      for (Map<String, Object> r : db.query("SELECT section, value FROM app_config")) fromDb.put((String) r.get("section"), J.parse(r.get("value")));
      c = J.merge(defaults, fromDb);
      cache = c;
      cacheAt = System.currentTimeMillis();
    }
    return J.merge(c, null);
  }

  @SuppressWarnings("unchecked")
  public Map<String, Object> section(Map<String, Object> cfg, String name) {
    Object v = cfg.get(name);
    return v instanceof Map<?, ?> m ? (Map<String, Object>) m : new LinkedHashMap<>();
  }

  /** Admin: replace one section of the shared settings. */
  public Object saveSection(String section, Map<String, Object> value, String userId) {
    if (!sections.contains(section)) throw ApiException.bad("Unknown settings section \"" + section + "\".");
    if (value == null) throw ApiException.bad("Settings must be a JSON object.");
    db.exec("INSERT INTO app_config (section, value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)",
        section, J.json(value), userId);
    invalidate();
    return app().get(section);
  }

  /** The agent's own setup as config sections (an agent row plus its emergency rules). */
  public Map<String, Object> overlay(Map<String, Object> a) {
    if (a == null) return new LinkedHashMap<>();
    Map<String, Object> models = new LinkedHashMap<>();
    Map<String, Object> stt = new LinkedHashMap<>();
    if (!J.blank(a.get("chat_model"))) models.put("chat", a.get("chat_model"));
    Map<String, Object> agentSec = new LinkedHashMap<>(J.map("defaultName", a.get("name"), "defaultLanguage", a.get("language"),
        "defaultVoice", a.get("voice"), "defaultPlaybookId", a.get("playbook_id") == null ? "" : a.get("playbook_id")));
    if (a.get("speech_speed") != null) agentSec.put("speechSpeed", J.dbl(a.get("speech_speed")));
    if (!J.blank(a.get("tts_model"))) models.put("tts", a.get("tts_model"));
    if (!J.blank(a.get("stt_engine"))) stt.put("engine", a.get("stt_engine"));
    if (!J.blank(a.get("stt_model"))) stt.put("model", a.get("stt_model"));
    return J.map(
        "agent", agentSec,
        "models", models, "speechToText", stt,
        "calendar", a.get("meeting_minutes") == null ? J.map("enabled", J.bool(a.get("calendar_enabled")))
            : J.map("enabled", J.bool(a.get("calendar_enabled")), "defaultDurationMin", a.get("meeting_minutes")),
        "emergency", J.map("enabled", J.bool(a.get("emergency_enabled")), "rules", a.getOrDefault("rules", List.of())));
  }

  /** Full settings for a request: shared settings + the agent's setup + env overrides. */
  public Map<String, Object> forAgent(Map<String, Object> agent) {
    Map<String, Object> cfg = J.merge(app(), overlay(agent));
    Map<String, Object> models = section(cfg, "models");
    String m = env.getProperty("OPENAI_MODEL");
    if (m != null && !m.isBlank()) models.put("chat", m);
    String t = env.getProperty("OPENAI_TTS_MODEL");
    if (t != null && !t.isBlank()) models.put("tts", t);
    String r = env.getProperty("OPENAI_REASONING_EFFORT");
    if (r != null && !r.isBlank()) models.put("reasoningEffort", r);
    // Older chat models (non gpt-5 / o-series) reject reasoning_effort.
    String chat = J.str(models.get("chat"));
    if (!chat.matches("^(gpt-5|o\\d).*")) models.put("reasoningEffort", "");
    // "none" exists from gpt-5.1 on; the first gpt-5 family (gpt-5, -mini, -nano) calls the lowest level "minimal".
    else if (chat.matches("^gpt-5(-.*)?$") && "none".equals(models.get("reasoningEffort"))) models.put("reasoningEffort", "minimal");
    else if (chat.matches("^gpt-5\\.\\d.*") && "minimal".equals(models.get("reasoningEffort"))) models.put("reasoningEffort", "none");
    return cfg;
  }

  /** The part of the settings the browser may see. */
  public Map<String, Object> publicConfig(Map<String, Object> cfg, Map<String, Object> agentCard) {
    Map<String, Object> conv = section(cfg, "conversation");
    Map<String, Object> stt = section(cfg, "speechToText");
    Map<String, Object> models = section(cfg, "models");
    boolean openaiStt = "openai".equals(stt.get("engine"));
    return J.map(
        "branding", cfg.get("branding"),
        "agent", cfg.get("agent"),
        "currentAgent", agentCard,
        "conversation", J.map("responseDelayMs", conv.get("responseDelayMs"), "hangupDelayMs", conv.get("hangupDelayMs"),
            "bargeIn", conv.get("bargeIn"), "bargeInMs", conv.get("bargeInMs"), "bargeInLevel", conv.get("bargeInLevel"),
            "silenceRetrySeconds", conv.get("silenceRetrySeconds"), "silenceRetries", conv.get("silenceRetries")),
        "history", J.map("pageSize", section(cfg, "history").get("pageSize")),
        "speechToText", J.map("engine", stt.get("engine"), "vadThreshold", stt.get("vadThreshold"),
            "minSpeechMs", stt.get("minSpeechMs"), "maxUtteranceSeconds", stt.get("maxUtteranceSeconds")),
        "models", J.map("chat", models.get("chat"), "tts", models.get("tts"), "stt", openaiStt ? stt.get("model") : "browser", "sttModel", stt.get("model")),
        "calendar", cfg.get("calendar"),
        "emergency", cfg.get("emergency"));
  }
}
