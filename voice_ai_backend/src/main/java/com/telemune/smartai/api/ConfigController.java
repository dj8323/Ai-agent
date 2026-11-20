package com.telemune.smartai.api;

import com.telemune.smartai.ai.OpenAiClient;
import com.telemune.smartai.ai.Prompts;
import com.telemune.smartai.ai.SpeechService;
import com.telemune.smartai.service.AgentService;
import com.telemune.smartai.service.AppConfigService;
import com.telemune.smartai.service.LogService;
import com.telemune.smartai.util.J;
import com.telemune.smartai.web.Ctx;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/** Settings the page needs, auto-save of the Agent setup card, and the OpenAI model list. */
@RestController
public class ConfigController {
  private static final Logger log = LoggerFactory.getLogger(ConfigController.class);
  private static final Map<String, Object> MODEL_FALLBACK = J.map(
      "chat", List.of("gpt-5.5", "gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"),
      "stt", List.of("gpt-4o-transcribe", "gpt-4o-mini-transcribe", "whisper-1"),
      "tts", List.of("gpt-4o-mini-tts", "tts-1-hd", "tts-1"));

  private final AppConfigService config;
  private final AgentService agents;
  private final OpenAiClient openai;
  private final LogService logs;
  private final SpeechService speech;
  private final com.telemune.smartai.service.NotifyService notify;
  private volatile Map<String, Object> modelCache;
  private volatile long modelCacheAt;

  public ConfigController(AppConfigService config, AgentService agents, OpenAiClient openai, LogService logs, SpeechService speech,
                          com.telemune.smartai.service.NotifyService notify) {
    this.speech = speech;
    this.notify = notify;
    this.config = config;
    this.agents = agents;
    this.openai = openai;
    this.logs = logs;
  }

  @GetMapping("/api/config")
  Map<String, Object> config(@RequestAttribute("ctx") Ctx ctx) {
    Map<String, Object> cfg = config.forAgent(ctx.agent);
    Map<String, Object> pub = config.publicConfig(cfg, agents.card(ctx.agent));
    return J.map("stale", false, "me", ctx.user, "model", J.get(cfg, "models.chat"), "ttsModel", J.get(cfg, "models.tts"),
        "sttModel", J.get(pub, "models.stt"), "languages", Prompts.LANGUAGE_NAMES, "voices", Prompts.VOICES,
        "emotions", Prompts.EMOTIONS.keySet(), "providers", speech.providers(), "channels", notify.channels(), "countryCodes", countryCodes(), "settings", pub);
  }

  /** Country dialling codes for mobile numbers (table country_codes, active rows, India first). */
  private List<Map<String, Object>> countryCodes() {
    return config.countryCodes();
  }

  /** Saves the Agent setup card into the active agent only (other agents and other users are untouched). */
  @PostMapping("/api/settings")
  Map<String, Object> save(@RequestBody Map<String, Object> body, @RequestAttribute("ctx") Ctx ctx) {
    if (!ctx.isAdmin() && body.get("models") instanceof Map<?, ?>) {
      // Only admins pick AI models; a user's agent always runs on the default models (providers and voice stay theirs).
      Map<String, Object> m = new java.util.LinkedHashMap<>(J.obj(body.get("models")));
      m.keySet().removeAll(java.util.Set.of("chat", "tts", "stt"));
      m.put("resetModels", true);
      body.put("models", m);
    }
    Map<String, Object> a = agents.saveSettings(body, ctx.agent);
    ctx.agent = a;
    logs.activity(ctx, "agent.settings", (String) a.get("name"), J.map("agentId", a.get("id"), "changed", body.keySet()));
    return J.map("ok", true, "settings", config.publicConfig(config.forAgent(a), agents.card(a)), "agent", agents.card(a));
  }

  /** Models available on this OpenAI account, grouped for the dropdowns (cached 10 minutes). */
  @GetMapping("/api/models")
  Map<String, Object> models() {
    if (modelCache != null && System.currentTimeMillis() - modelCacheAt < 10 * 60 * 1000) return modelCache;
    try {
      List<String> ids = openai.models().stream().sorted().toList();
      // Leave out realtime/live models (they need a different API), dated snapshots and non-chat models.
      Map<String, Object> data = J.map(
          "chat", pick(ids, "^(gpt-|o\\d|chatgpt).*", ".*(audio|realtime|live|tts|transcribe|image|embedding|search|instruct|moderation|diarize|codex|-\\d{4}-\\d{2}-\\d{2}).*"),
          "stt", pick(ids, ".*(transcribe|whisper).*", ".*(diarize|realtime|live|-\\d{4}-\\d{2}-\\d{2}).*"),
          "tts", pick(ids, ".*tts.*", ".*(realtime|live|audio-preview|-\\d{4}-\\d{2}-\\d{2}|-\\d{4}$).*"),
          "source", "account");
      for (String k : List.of("chat", "stt", "tts")) if (((List<?>) data.get(k)).isEmpty()) data.put(k, MODEL_FALLBACK.get(k));
      modelCache = data;
      modelCacheAt = System.currentTimeMillis();
      return data;
    } catch (Exception e) {
      log.warn("Couldn't list models, using defaults: {}", e.getMessage());
      Map<String, Object> out = J.merge(MODEL_FALLBACK, null);
      out.put("source", "fallback");
      return out;
    }
  }

  private static List<String> pick(List<String> ids, String yes, String no) {
    Pattern y = Pattern.compile(yes), n = Pattern.compile(no);
    return ids.stream().filter(id -> y.matcher(id).matches() && !n.matcher(id).matches()).toList();
  }
}
