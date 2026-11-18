package com.telemune.smartai;

import com.telemune.smartai.ai.OpenAiClient;
import com.telemune.smartai.service.AgentService;
import com.telemune.smartai.service.AppConfigService;
import com.telemune.smartai.service.AuthService;
import com.telemune.smartai.util.J;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.util.Map;

/** Start-up (before requests are served): seed app settings from config.json, create the first admin if needed. */
@Component
public class Bootstrap {
  private static final Logger log = LoggerFactory.getLogger(Bootstrap.class);
  private final AppConfigService config;
  private final AuthService auth;
  private final AgentService agents;
  private final OpenAiClient openai;
  private final Environment env;

  public Bootstrap(AppConfigService config, AuthService auth, AgentService agents, OpenAiClient openai, Environment env) {
    this.config = config;
    this.auth = auth;
    this.agents = agents;
    this.openai = openai;
    this.env = env;
  }

  @PostConstruct
  void init() {
    config.seed();
    Map<String, Object> admin = auth.ensureAdmin();
    if (admin != null) {
      log.info("Created admin account \"admin\" (password admin@123, change it after signing in).");
    }
  }

  @EventListener(ApplicationReadyEvent.class)
  void ready() {
    Map<String, Object> cfg = config.app();
    log.info("{} backend running at http://{}:{}  (MySQL: {}, chat: {}, voice: {})", J.get(cfg, "branding.appName"),
        env.getProperty("server.address", "localhost"), env.getProperty("local.server.port"), env.getProperty("MYSQL_DATABASE", "ai-agent"),
        J.get(cfg, "models.chat"), J.get(cfg, "models.tts"));
    if (!openai.hasKey()) log.warn("OPENAI_API_KEY is not set — calls will fail until you add it to .env");
  }
}
