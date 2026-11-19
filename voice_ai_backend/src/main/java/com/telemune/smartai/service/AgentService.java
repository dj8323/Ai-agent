package com.telemune.smartai.service;

import com.telemune.smartai.ai.SpeechService;

import com.telemune.smartai.db.Db;
import com.telemune.smartai.util.J;
import com.telemune.smartai.web.ApiException;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * Agents: every user can create as many as they need (personal, call assistant, hospital, HR, banking …).
 * Each agent keeps its own name, language, voice, models, template/persona, playbook, calendar switch and emergency
 * numbers (tables agents + emergency_rules). Saving one agent never changes another agent or another user.
 */
@Service
public class AgentService {
  private static final Pattern MODEL_ID = Pattern.compile("^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,79}$");
  private static final Pattern AGENT_ID = Pattern.compile("^[a-zA-Z0-9-]{1,16}$");

  private final Db db;
  private final AppConfigService config;
  private final TemplateService templates;
  private final Map<String, Object> locks = new ConcurrentHashMap<>();

  public AgentService(Db db, AppConfigService config, TemplateService templates) {
    this.db = db;
    this.config = config;
    this.templates = templates;
  }

  private static String modelId(Object v) {
    String s = J.str(v);
    return MODEL_ID.matcher(s).matches() ? s : null;
  }

  private Map<String, Object> withRules(Map<String, Object> a) {
    if (a == null) return null;
    Map<String, Object> out = new LinkedHashMap<>(a);
    List<Map<String, Object>> rules = new ArrayList<>();
    for (Map<String, Object> r : db.query("SELECT label, contact_type, number, keywords FROM emergency_rules WHERE agent_id = ? ORDER BY sort_order, id", a.get("id"))) {
      rules.add(J.map("label", r.get("label"), "type", r.get("contact_type"), "number", r.get("number"), "keywords", J.strings(r.get("keywords"))));
    }
    out.put("rules", rules);
    return out;
  }

  /** One agent of this user (with its emergency rules), or null. */
  public Map<String, Object> get(String id, String userId) {
    if (J.blank(id)) return null;
    return withRules(db.one("SELECT * FROM agents WHERE id = ? AND user_id = ?", id, userId));
  }

  public List<Map<String, Object>> list(String userId) {
    return db.query("SELECT * FROM agents WHERE user_id = ? ORDER BY is_default DESC, created_at", userId);
  }

  /** What the browser and the admin dashboard see. */
  public Map<String, Object> card(Map<String, Object> a) {
    if (a == null) return null;
    Map<String, Object> type = templates.type(J.str(a.get("agent_type")));
    Map<String, Object> tp = templates.template(J.str(a.get("template_id")));
    return J.map("id", a.get("id"), "name", a.get("name"), "type", a.get("agent_type"),
        "typeName", type == null ? "Custom" : type.get("name"), "icon", type == null ? "✨" : type.get("icon"),
        "needsOwner", type != null && J.bool(type.get("needsOwner")),
        "description", a.get("description"), "language", a.get("language"), "voice", a.get("voice"),
        "chatModel", a.get("chat_model"), "ttsModel", a.get("tts_model"),
        "ttsProvider", J.blank(a.get("tts_provider")) ? "openai" : a.get("tts_provider"),
        "sttProvider", J.blank(a.get("stt_provider")) ? "openai" : a.get("stt_provider"),
        "notify", a.get("notify") == null ? cleanNotify(J.map()) : J.parse(a.get("notify")),
        "stt", "browser".equals(a.get("stt_engine")) ? "browser" : a.get("stt_model"),
        "playbookId", a.get("playbook_id") == null ? "" : a.get("playbook_id"),
        "templateId", a.get("template_id") == null ? "" : a.get("template_id"), "templateName", tp == null ? null : tp.get("name"),
        "ownerName", J.str(a.get("owner_name")), "organization", J.str(a.get("organization")),
        "availability", J.str(a.get("owner_availability")), "availabilityPlan", J.parse(a.get("availability_plan")),
        "meetingMinutes", a.get("meeting_minutes"), "speechSpeed", a.get("speech_speed") == null ? null : J.dbl(a.get("speech_speed")),
        "greeting", J.str(a.get("greeting")),
        "greetingPreview", templates.greeting(a, null),
        "calendar", J.bool(a.get("calendar_enabled")), "emergency", J.bool(a.get("emergency_enabled")), "isDefault", J.bool(a.get("is_default")),
        "createdAt", J.iso(a.get("created_at")), "updatedAt", J.iso(a.get("updated_at")));
  }

  /** Create an agent. Its setup starts from the app defaults; its type and template decide its persona and script. */
  public Map<String, Object> create(Map<String, Object> in, String userId) {
    Map<String, Object> cfg = config.app();
    Map<String, Object> agentCfg = config.section(cfg, "agent");
    long count = db.count("SELECT COUNT(*) FROM agents WHERE user_id = ?", userId);
    long max = J.num(agentCfg.get("maxAgentsPerUser")) > 0 ? J.num(agentCfg.get("maxAgentsPerUser")) : 20;
    if (count >= max) throw ApiException.bad("You can have up to " + max + " agents.");
    String type = templates.validType(in.get("type"));
    Map<String, Object> typeCard = templates.type(type);
    String owner = J.str(in.get("ownerName"), 60);
    if (typeCard != null && J.bool(typeCard.get("needsOwner")) && owner.isEmpty()) {
      throw ApiException.bad("Who does this " + typeCard.get("name") + " work for? Add their name.");
    }
    String templateId = in.containsKey("templateId") ? templates.validTemplate(in.get("templateId"), type) : templates.defaultTemplateId(type);
    String name = J.str(in.get("name"), 24);
    if (name.isEmpty()) name = J.str(agentCfg.get("defaultName"));
    String id = J.newId();
    String description = J.str(in.get("description"), 300);
    if (description.isEmpty() && typeCard != null) description = J.str(typeCard.get("description"), 300);
    boolean calendar = in.containsKey("calendar") ? J.bool(in.get("calendar"))
        : (typeCard != null && J.bool(typeCard.get("defaultCalendar"))) || J.bool(J.get(cfg, "calendar.enabled"));
    boolean emergency = in.containsKey("emergency") ? J.bool(in.get("emergency")) : J.bool(J.get(cfg, "emergency.enabled"));
    List<Object> rules = in.get("rules") instanceof List<?> ? J.list(in.get("rules")) : J.list(J.get(cfg, "emergency.rules"));
    String language = J.str(in.get("language"), 10);
    String voice = J.str(in.get("voice"), 20);
    String sttEngine = "browser".equals(in.get("sttEngine")) ? "browser" : "openai".equals(in.get("sttEngine")) ? "openai" : null;
    final String fName = name, fDesc = description;
    db.tx(() -> {
      db.exec("INSERT INTO agents (id, user_id, name, agent_type, description, language, voice, playbook_id, calendar_enabled, emergency_enabled, is_default, "
              + "chat_model, tts_model, stt_engine, stt_model, template_id, owner_name, organization, owner_availability, greeting) "
              + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          id, userId, fName, type, fDesc,
          language.isEmpty() ? J.str(agentCfg.get("defaultLanguage")) : language, voice.isEmpty() ? J.str(agentCfg.get("defaultVoice")) : voice,
          J.blank(in.get("playbookId")) ? null : J.str(in.get("playbookId"), 16), calendar ? 1 : 0, emergency ? 1 : 0,
          count == 0 || J.bool(in.get("isDefault")) ? 1 : 0,
          modelId(in.get("chatModel")), modelId(in.get("ttsModel")), sttEngine, modelId(in.get("sttModel")),
          templateId, owner, J.str(in.get("organization"), 80), J.str(in.get("availability"), 300), J.str(in.get("greeting"), 400));
      if (J.bool(in.get("isDefault")) && count > 0) db.exec("UPDATE agents SET is_default = 0 WHERE user_id = ? AND id <> ?", userId, id);
      writeRules(id, rules);
    });
    return get(id, userId);
  }

  /**
   * The agent a request is for: the one asked for (if it's theirs), else their default agent, else null.
   * New accounts start with no agents (the page shows the "Create your first agent" tutorial); nothing is made for them.
   */
  public Map<String, Object> resolve(String userId, String requestedId) {
    if (requestedId != null && AGENT_ID.matcher(requestedId).matches()) {
      Map<String, Object> a = get(requestedId, userId);
      if (a != null) return a;
    }
    return withRules(db.one("SELECT * FROM agents WHERE user_id = ? ORDER BY is_default DESC, created_at LIMIT 1", userId));
  }

  /** Rename / describe / change type / make default / persona fields. */
  public Map<String, Object> updateInfo(String id, Map<String, Object> in, String userId) {
    Map<String, Object> a = get(id, userId);
    if (a == null) throw ApiException.notFound("Agent not found.");
    if (in.containsKey("name")) {
      String n = J.str(in.get("name"), 24);
      db.exec("UPDATE agents SET name = ? WHERE id = ?", n.isEmpty() ? a.get("name") : n, id);
    }
    if (in.containsKey("description")) db.exec("UPDATE agents SET description = ? WHERE id = ?", J.str(in.get("description"), 300), id);
    if (in.containsKey("type")) {
      Map<String, Object> newType = templates.type(J.str(in.get("type")));
      if (newType == null || !J.bool(newType.get("active"))) throw ApiException.bad("That agent type doesn't exist or is switched off.");
      String type = (String) newType.get("key");
      if (!type.equals(a.get("agent_type"))) {
        // A new type is a new job: reset everything role-specific to the new type's / app's defaults (the page asks
        // first). Kept: name, language, voice and AI models.
        Map<String, Object> cfg = config.app();
        boolean calendar = J.bool(newType.get("defaultCalendar")) || J.bool(J.get(cfg, "calendar.enabled"));
        boolean emergency = J.bool(J.get(cfg, "emergency.enabled"));
        List<Object> rules = J.list(J.get(cfg, "emergency.rules"));
        db.tx(() -> {
          db.exec("UPDATE agents SET agent_type = ?, template_id = ?, description = ?, playbook_id = NULL, greeting = '', owner_name = '', "
                  + "organization = '', owner_availability = '', availability_plan = NULL, meeting_minutes = NULL, calendar_enabled = ?, "
                  + "emergency_enabled = ? WHERE id = ?",
              type, templates.defaultTemplateId(type), J.str(newType.get("description"), 300), calendar ? 1 : 0, emergency ? 1 : 0, id);
          writeRules(id, rules);
        });
      }
    }
    writePersona(id, userId, in);
    if (J.bool(in.get("isDefault"))) db.exec("UPDATE agents SET is_default = (id = ?) WHERE user_id = ?", id, userId);
    return get(id, userId);
  }

  /** Persona fields (from the New agent dialog, the 🎭 Persona section, or PATCH). Only keys present are changed. */
  private void writePersona(String id, String userId, Map<String, Object> p) {
    Map<String, Object> a = db.one("SELECT agent_type FROM agents WHERE id = ? AND user_id = ?", id, userId);
    if (a == null) return;
    if (p.containsKey("templateId")) {
      // "" = no template (free conversation); an id that isn't an active template of this agent's type is ignored.
      String tid = templates.validTemplate(p.get("templateId"), (String) a.get("agent_type"));
      if (tid != null || J.blank(p.get("templateId"))) db.exec("UPDATE agents SET template_id = ? WHERE id = ?", tid, id);
    }
    if (p.containsKey("ownerName")) db.exec("UPDATE agents SET owner_name = ? WHERE id = ?", J.str(p.get("ownerName"), 60), id);
    if (p.containsKey("description")) db.exec("UPDATE agents SET description = ? WHERE id = ?", J.str(p.get("description"), 300), id);
    if (p.containsKey("organization")) db.exec("UPDATE agents SET organization = ? WHERE id = ?", J.str(p.get("organization"), 80), id);
    if (p.containsKey("availability")) db.exec("UPDATE agents SET owner_availability = ? WHERE id = ?", J.str(p.get("availability"), 300), id);
    if (p.containsKey("availabilityPlan")) db.exec("UPDATE agents SET availability_plan = ? WHERE id = ?", cleanPlan(p.get("availabilityPlan")), id);
    if (p.containsKey("greeting")) db.exec("UPDATE agents SET greeting = ? WHERE id = ?", J.str(p.get("greeting"), 400), id);
  }

  private static final Pattern HHMM = Pattern.compile("^([01]\\d|2[0-3]):[0-5]\\d$");

  /** Availability picker → JSON {days:[1..7] (1 = Monday), from, to, tz, note}, or null. */
  private static String cleanPlan(Object v) {
    Map<String, Object> p = J.obj(v);
    if (p.isEmpty()) return null;
    List<Long> days = new ArrayList<>();
    for (Object d : J.list(p.get("days"))) {
      long n = J.num(d);
      if (n >= 1 && n <= 7 && !days.contains(n)) days.add(n);
    }
    days.sort(null);
    String from = J.str(p.get("from")), to = J.str(p.get("to"));
    return J.json(J.map("days", days, "from", HHMM.matcher(from).matches() ? from : "09:00", "to", HHMM.matcher(to).matches() ? to : "18:00",
        "tz", J.str(p.get("tz"), 60), "note", J.str(p.get("note"), 200)));
  }

  private static final Pattern EMAIL = Pattern.compile("^[^\\s@]{1,64}@[^\\s@]{1,60}\\.[^\\s@]{2,}$");

  public Map<String, Object> delete(String id, String userId) {
    Map<String, Object> a = get(id, userId);
    if (a == null) throw ApiException.notFound("Agent not found.");
    db.exec("DELETE FROM agents WHERE id = ?", id); // calls, events and messages keep their history (agent_id → NULL)
    if (J.bool(a.get("is_default"))) db.exec("UPDATE agents SET is_default = 1 WHERE user_id = ? ORDER BY created_at LIMIT 1", userId);
    return a;
  }

  private void writeRules(String agentId, List<Object> rules) {
    db.exec("DELETE FROM emergency_rules WHERE agent_id = ?", agentId);
    int i = 0;
    for (Object o : rules) {
      Map<String, Object> r = J.obj(o);
      String label = J.str(r.get("label"), 40);
      boolean email = "email".equals(r.get("type"));
      String kind = email ? "email" : "whatsapp".equals(r.get("type")) ? "whatsapp" : "phone";
      String number = email ? J.str(r.get("number"), 120).toLowerCase() : J.str(r.get("number"), 20).replaceAll("[^\\d+*# -]", "");
      if (email && !EMAIL.matcher(number).matches()) continue;
      LinkedHashSet<String> kws = new LinkedHashSet<>();
      for (String k : J.strings(r.get("keywords"))) {
        String kk = J.str(k, 40).toLowerCase();
        if (!kk.isEmpty() && kws.size() < 30) kws.add(kk);
      }
      if (label.isEmpty() || number.isEmpty() || kws.isEmpty()) continue;
      if (i >= 20) break;
      db.exec("INSERT INTO emergency_rules (agent_id, label, contact_type, number, keywords, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
          agentId, label, kind, number, J.json(new ArrayList<>(kws)), i++);
    }
  }

  /** Call-summary delivery: {whatsapp:{on,to}, email:{on,to}, sms:{on,to}} with tidy numbers / addresses. */
  static Map<String, Object> cleanNotify(Map<String, Object> in) {
    Map<String, Object> out = new java.util.LinkedHashMap<>();
    for (String ch : List.of("whatsapp", "email", "sms")) {
      Map<String, Object> c = J.obj(in.get(ch));
      String to = "email".equals(ch) ? J.str(c.get("to"), 200).toLowerCase().replaceAll("\\s+", "") : J.str(c.get("to"), 20).replaceAll("[^\\d+]", "");
      if ("email".equals(ch)) {
        List<String> ok = new ArrayList<>();
        for (String e : to.split("[,;]")) if (EMAIL.matcher(e).matches() && ok.size() < 5) ok.add(e);
        to = String.join(",", ok);
      }
      out.put(ch, J.map("on", J.bool(c.get("on")) && !to.isEmpty(), "to", to));
    }
    return out;
  }

  /** Saves from the Agent setup card (auto-save). Runs one at a time per agent, so quick edits can't interleave. */
  public Map<String, Object> saveSettings(Map<String, Object> in, Map<String, Object> agent) {
    if (agent == null) throw ApiException.bad("Create an agent first.");
    String agentId = (String) agent.get("id");
    String userId = (String) agent.get("user_id");
    synchronized (locks.computeIfAbsent(agentId, k -> new Object())) {
      Map<String, Object> a = J.obj(in.get("agent"));
      Map<String, Object> m = J.obj(in.get("models"));
      db.tx(() -> {
        if (!J.blank(a.get("defaultName"))) db.exec("UPDATE agents SET name = ? WHERE id = ? AND user_id = ?", J.str(a.get("defaultName"), 24), agentId, userId);
        if (!J.blank(a.get("defaultLanguage"))) db.exec("UPDATE agents SET language = ? WHERE id = ? AND user_id = ?", J.str(a.get("defaultLanguage"), 10), agentId, userId);
        if (!J.blank(a.get("defaultVoice"))) db.exec("UPDATE agents SET voice = ? WHERE id = ? AND user_id = ?", J.str(a.get("defaultVoice"), 64), agentId, userId);
        if (a.containsKey("speechSpeed")) {
          Double sp = J.dbl(a.get("speechSpeed"));
          db.exec("UPDATE agents SET speech_speed = ? WHERE id = ?", sp == null ? null : Math.round(Math.min(2.0, Math.max(0.5, sp)) * 100) / 100.0, agentId);
        }
        if (a.containsKey("defaultPlaybookId")) {
          String pb = J.str(a.get("defaultPlaybookId"), 16);
          boolean ok = !pb.isEmpty() && db.one("SELECT id FROM playbooks WHERE id = ? AND user_id = ?", pb, userId) != null;
          db.exec("UPDATE agents SET playbook_id = ? WHERE id = ? AND user_id = ?", ok ? pb : null, agentId, userId);
        }
        if (modelId(m.get("chat")) != null) db.exec("UPDATE agents SET chat_model = ? WHERE id = ?", m.get("chat"), agentId);
        if (modelId(m.get("tts")) != null) db.exec("UPDATE agents SET tts_model = ? WHERE id = ?", m.get("tts"), agentId);
        if (m.containsKey("ttsProvider")) db.exec("UPDATE agents SET tts_provider = ? WHERE id = ?", SpeechService.TTS.contains(J.str(m.get("ttsProvider"))) ? m.get("ttsProvider") : null, agentId);
        if (m.containsKey("sttProvider")) db.exec("UPDATE agents SET stt_provider = ? WHERE id = ?", SpeechService.STT.contains(J.str(m.get("sttProvider"))) ? m.get("sttProvider") : null, agentId);
        if ("browser".equals(m.get("stt"))) db.exec("UPDATE agents SET stt_engine = 'browser' WHERE id = ?", agentId);
        else if (modelId(m.get("stt")) != null) db.exec("UPDATE agents SET stt_engine = 'openai', stt_model = ? WHERE id = ?", m.get("stt"), agentId);
        if (in.get("calendar") instanceof Map<?, ?>) {
          Map<String, Object> cal = J.obj(in.get("calendar"));
          db.exec("UPDATE agents SET calendar_enabled = ? WHERE id = ?", J.bool(cal.get("enabled")) ? 1 : 0, agentId);
          if (cal.containsKey("defaultDurationMin")) {
            long mins = J.num(cal.get("defaultDurationMin"));
            db.exec("UPDATE agents SET meeting_minutes = ? WHERE id = ?", mins >= 5 && mins <= 480 ? mins : null, agentId);
          }
        }
        if (in.get("emergency") instanceof Map<?, ?>) {
          Map<String, Object> e = J.obj(in.get("emergency"));
          db.exec("UPDATE agents SET emergency_enabled = ? WHERE id = ?", J.bool(e.get("enabled")) ? 1 : 0, agentId);
          writeRules(agentId, J.list(e.get("rules")));
        }
        if (in.get("persona") instanceof Map<?, ?>) writePersona(agentId, userId, J.obj(in.get("persona")));
        if (in.get("notify") instanceof Map<?, ?>) db.exec("UPDATE agents SET notify = ? WHERE id = ?", J.json(cleanNotify(J.obj(in.get("notify")))), agentId);
      });
      return get(agentId, userId);
    }
  }
}
