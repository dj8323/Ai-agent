package com.telemune.smartai.api;

import com.telemune.smartai.service.AgentService;
import com.telemune.smartai.service.AppConfigService;
import com.telemune.smartai.service.AuthService;
import com.telemune.smartai.service.CalendarService;
import com.telemune.smartai.service.CallService;
import com.telemune.smartai.service.LogService;
import com.telemune.smartai.service.MessageService;
import com.telemune.smartai.service.PlaybookService;
import com.telemune.smartai.service.TemplateService;
import com.telemune.smartai.util.J;
import com.telemune.smartai.web.ApiException;
import com.telemune.smartai.web.Ctx;
import org.springframework.boot.logging.LogLevel;
import org.springframework.boot.logging.LoggingSystem;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Admin dashboard (role 1 only; ApiFilter checks the role): users, totals, logs, app settings, agent types & templates. */
@RestController
@RequestMapping("/api/admin")
public class AdminController {
  private final AuthService auth;
  private final AgentService agents;
  private final AppConfigService config;
  private final TemplateService templates;
  private final PlaybookService playbooks;
  private final CallService calls;
  private final CalendarService calendar;
  private final MessageService messages;
  private final LogService logs;
  private final LoggingSystem logging;

  public AdminController(AuthService auth, AgentService agents, AppConfigService config, TemplateService templates, PlaybookService playbooks,
                         CallService calls, CalendarService calendar, MessageService messages, LogService logs, LoggingSystem logging) {
    this.logging = logging;
    this.auth = auth;
    this.agents = agents;
    this.config = config;
    this.templates = templates;
    this.playbooks = playbooks;
    this.calls = calls;
    this.calendar = calendar;
    this.messages = messages;
    this.logs = logs;
  }

  /** One user with all their agents and totals, in the shape the dashboard cards use. */
  private Map<String, Object> snapshot(Map<String, Object> u) {
    String uid = (String) u.get("id");
    Map<String, Object> stats = calls.stats(uid);
    List<Map<String, Object>> pbs = playbooks.list(uid);
    List<Map<String, Object>> cards = new ArrayList<>();
    for (Map<String, Object> row : agents.list(uid)) {
      Map<String, Object> full = agents.get((String) row.get("id"), uid);
      Map<String, Object> cfg = config.forAgent(full);
      Map<String, Object> card = agents.card(row);
      String pbName = pbs.stream().filter(p -> p.get("id").equals(row.get("playbook_id"))).map(p -> (String) p.get("name")).findFirst().orElse(null);
      card.put("playbook", pbName);
      card.put("llm", J.get(cfg, "models.chat"));
      card.put("tts", J.get(cfg, "models.tts"));
      card.put("stt", "openai".equals(J.get(cfg, "speechToText.engine")) ? J.get(cfg, "speechToText.model") : "browser");
      card.put("emergencyNumbers", J.list(J.get(cfg, "emergency.rules")).size());
      cards.add(card);
    }
    Map<String, Object> main = cards.stream().filter(c -> J.bool(c.get("isDefault"))).findFirst().orElse(cards.isEmpty() ? null : cards.get(0));
    List<?> recent = (List<?>) calls.list(1, 1, null, uid).get("items");
    Map<String, Object> out = new LinkedHashMap<>(u);
    out.put("agents", cards);
    out.put("agent", main == null ? null : J.map("name", main.get("name"), "language", main.get("language"), "voice", main.get("voice"),
        "playbook", main.get("playbook"), "llm", main.get("llm"), "stt", main.get("stt"), "tts", main.get("tts"), "calendar", main.get("calendar"),
        "emergency", main.get("emergency"), "emergencyNumbers", main.get("emergencyNumbers")));
    out.put("playbooks", pbs.stream().map(p -> J.map("id", p.get("id"), "name", p.get("name"), "type", p.get("type"), "goal", p.get("goal"))).toList());
    out.put("events", calendar.list(uid).size());
    out.put("messages", messages.newCount(uid));
    out.put("stats", stats);
    out.put("lastCallAt", recent.isEmpty() ? null : J.obj(recent.get(0)).get("startedAt"));
    return out;
  }

  @GetMapping("/overview")
  Map<String, Object> overview() {
    List<Map<String, Object>> users = auth.listUsers().stream().map(this::snapshot).toList();
    long agentsN = 0, calls = 0, seconds = 0, turns = 0, tokens = 0, recordings = 0, pbs = 0, events = 0, msgs = 0;
    List<Long> replies = new ArrayList<>();
    for (Map<String, Object> u : users) {
      Map<String, Object> st = J.obj(u.get("stats"));
      agentsN += ((List<?>) u.get("agents")).size();
      calls += J.num(st.get("calls"));
      seconds += J.num(st.get("totalSeconds"));
      turns += J.num(st.get("turns"));
      tokens += J.num(J.get(st, "tokens.total"));
      recordings += J.num(st.get("recordings"));
      pbs += ((List<?>) u.get("playbooks")).size();
      events += J.num(u.get("events"));
      msgs += J.num(u.get("messages"));
      if (st.get("avgResponseMs") != null) replies.add(J.num(st.get("avgResponseMs")));
    }
    return J.map("totals", J.map("users", users.size(),
            "admins", users.stream().filter(u -> J.num(u.get("role")) == AuthService.ROLE_ADMIN).count(),
            "active", users.stream().filter(u -> !J.bool(u.get("disabled"))).count(),
            "agents", agentsN, "calls", calls, "seconds", seconds, "turns", turns, "tokens", tokens, "recordings", recordings,
            "playbooks", pbs, "events", events, "messages", msgs,
            "templates", templates.catalog(true).values().stream().mapToInt(t -> ((List<?>) J.obj(t).get("templates")).size()).sum(),
            "avgResponseMs", replies.isEmpty() ? null : Math.round(replies.stream().mapToLong(Long::longValue).average().orElse(0))),
        "api", logs.apiStats(), "users", users);
  }

  @GetMapping("/logs")
  Map<String, Object> activity(@RequestParam(defaultValue = "1") int page, @RequestParam(required = false) String user) {
    return logs.listActivity(page, 15, J.blank(user) ? null : user);
  }

  @GetMapping("/logins")
  Map<String, Object> logins(@RequestParam(defaultValue = "1") int page) {
    return logs.listLogins(page, 15);
  }

  // ---------- app settings ----------
  @GetMapping("/config")
  Map<String, Object> appConfig() {
    return J.map("sections", config.sections, "config", config.app());
  }

  @PutMapping("/config/{section}")
  Map<String, Object> saveConfig(@PathVariable String section, @RequestBody Map<String, Object> body, @RequestAttribute("ctx") Ctx ctx) {
    Object value = config.saveSection(section, body, ctx.userId());
    logs.activity(ctx, "config.update", section, value);
    return J.map("ok", true, "value", value);
  }

  // ---------- users ----------
  @PostMapping("/users")
  ResponseEntity<Map<String, Object>> createUser(@RequestBody Map<String, Object> body, @RequestAttribute("ctx") Ctx ctx) {
    Map<String, Object> u = auth.createUser(body, "admin");
    logs.activity(ctx, "user.create", (String) u.get("username"), J.map("role", u.get("role")));
    return ResponseEntity.status(201).body(u);
  }

  @GetMapping("/users/{id}")
  Map<String, Object> user(@PathVariable String id) {
    Map<String, Object> u = auth.getUser(id);
    if (u == null) throw ApiException.notFound("User not found.");
    return snapshot(AuthService.publicUser(u));
  }

  @PatchMapping("/users/{id}")
  Map<String, Object> updateUser(@PathVariable String id, @RequestBody Map<String, Object> body, @RequestAttribute("ctx") Ctx ctx) {
    Map<String, Object> u = auth.updateUser(id, body, ctx.userId());
    Map<String, Object> details = new LinkedHashMap<>(body);
    if (details.containsKey("password")) details.put("password", "(reset)");
    logs.activity(ctx, "user.update", (String) u.get("username"), details);
    return u;
  }

  @DeleteMapping("/users/{id}")
  Map<String, Object> deleteUser(@PathVariable String id, @RequestAttribute("ctx") Ctx ctx) {
    Map<String, Object> u = auth.deleteUser(id, ctx.userId());
    logs.activity(ctx, "user.delete", (String) u.get("username"), J.map("id", id));
    return J.map("ok", true);
  }

  // ---------- agent types & templates (stored in agent_types / agent_templates) ----------
  @GetMapping("/templates")
  Map<String, Object> templates() {
    Map<String, Object> types = templates.catalog(true);
    for (Object t : types.values()) {
      for (Object tp : (List<?>) J.obj(t).get("templates")) {
        Map<String, Object> m = J.obj(tp);
        m.put("agents", templates.agentsUsingTemplate((String) m.get("id")));
      }
    }
    return J.map("types", types);
  }

  @PostMapping("/types")
  ResponseEntity<Map<String, Object>> createType(@RequestBody Map<String, Object> body, @RequestAttribute("ctx") Ctx ctx) {
    Map<String, Object> t = templates.saveType(null, body, ctx.userId());
    logs.activity(ctx, "type.create", (String) t.get("name"), J.map("key", t.get("key")));
    return ResponseEntity.status(201).body(t);
  }

  @PutMapping("/types/{key}")
  Map<String, Object> saveType(@PathVariable String key, @RequestBody Map<String, Object> body, @RequestAttribute("ctx") Ctx ctx) {
    Map<String, Object> t = templates.saveType(key, body, ctx.userId());
    logs.activity(ctx, "type.update", (String) t.get("name"), J.map("key", key, "changed", body.keySet()));
    return t;
  }

  @PostMapping("/templates")
  ResponseEntity<Map<String, Object>> createTemplate(@RequestBody Map<String, Object> body, @RequestAttribute("ctx") Ctx ctx) {
    Map<String, Object> t = templates.saveTemplate(null, body, ctx.userId());
    logs.activity(ctx, "template.create", (String) t.get("name"), J.map("id", t.get("id"), "type", t.get("type")));
    return ResponseEntity.status(201).body(t);
  }

  @PutMapping("/templates/{id}")
  Map<String, Object> saveTemplate(@PathVariable String id, @RequestBody Map<String, Object> body, @RequestAttribute("ctx") Ctx ctx) {
    Map<String, Object> t = templates.saveTemplate(id, body, ctx.userId());
    logs.activity(ctx, "template.update", (String) t.get("name"), J.map("id", id, "changed", body.keySet()));
    return t;
  }

  @DeleteMapping("/templates/{id}")
  Map<String, Object> deleteTemplate(@PathVariable String id, @RequestAttribute("ctx") Ctx ctx) {
    Map<String, Object> t = templates.deleteTemplate(id);
    logs.activity(ctx, "template.delete", (String) t.get("name"), J.map("id", id));
    return J.map("ok", true);
  }

  // ---------- log levels (live, until the next restart; the start level comes from LOG_LEVEL / SQL_LOG in .env) ----------
  private static final List<String> LOGGERS = List.of("com.telemune", "SQL");

  @GetMapping("/log-level")
  Map<String, Object> logLevels() {
    Map<String, Object> out = new LinkedHashMap<>();
    for (String name : LOGGERS) {
      var c = logging.getLoggerConfiguration(name);
      out.put(name, c == null || c.getEffectiveLevel() == null ? null : c.getEffectiveLevel().name());
    }
    return out;
  }

  /** Body {logger: "com.telemune" (app) or "SQL", level: "DEBUG" | "INFO" | "WARN" | "ERROR"}. */
  @PutMapping("/log-level")
  Map<String, Object> setLogLevel(@RequestBody Map<String, Object> body, @RequestAttribute("ctx") Ctx ctx) {
    String name = J.str(body.get("logger"));
    String level = J.str(body.get("level")).toUpperCase();
    if (!LOGGERS.contains(name)) throw ApiException.bad("logger must be one of " + LOGGERS);
    if (!List.of("TRACE", "DEBUG", "INFO", "WARN", "ERROR").contains(level)) throw ApiException.bad("level must be DEBUG, INFO, WARN or ERROR");
    logging.setLogLevel(name, LogLevel.valueOf(level));
    logs.activity(ctx, "log.level", name, J.map("level", level));
    return logLevels();
  }
}
