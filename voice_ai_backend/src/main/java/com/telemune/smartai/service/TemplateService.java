package com.telemune.smartai.service;

import com.telemune.smartai.db.Db;
import com.telemune.smartai.util.J;
import com.telemune.smartai.web.ApiException;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Agent types and their ready-made templates (tables agent_types + agent_templates). Admins edit them in the dashboard;
 * agents point at a template, so a change reaches every agent using it on its next call.
 * Text may use {agent}, {owner}, {org}; a [[ … ]] part is dropped when a value inside it is empty.
 */
@Service
public class TemplateService {
  private static final Pattern OPTIONAL = Pattern.compile("\\[\\[(.*?)]]", Pattern.DOTALL);
  private static final Pattern VAR = Pattern.compile("\\{(agent|owner|org)}");
  private static final Pattern TYPE_KEY = Pattern.compile("^[a-z][a-z0-9_]{1,29}$");

  private final Db db;
  private volatile Map<String, Map<String, Object>> cache;
  private volatile long cacheAt;

  public TemplateService(Db db) {
    this.db = db;
  }

  public void invalidate() {
    cache = null;
  }

  // ---------- reading ----------

  public static Map<String, Object> templateCard(Map<String, Object> r) {
    return J.map("id", r.get("id"), "type", r.get("type_key"), "name", r.get("name"), "role", r.get("role"), "greeting", r.get("greeting"),
        "goal", r.get("goal"), "steps", J.strings(r.get("steps")), "rules", J.strings(r.get("rules")), "summary", r.get("summary_focus"),
        "isDefault", J.bool(r.get("is_default")), "sortOrder", J.num(r.get("sort_order")), "active", J.bool(r.get("active")),
        "updatedAt", J.iso(r.get("updated_at")));
  }

  /** Every type (active or not) with all its templates, in display order: key → type card. Cached for 3 s. */
  private Map<String, Map<String, Object>> all() {
    Map<String, Map<String, Object>> c = cache;
    if (c != null && System.currentTimeMillis() - cacheAt < 3000) return c;
    Map<String, Map<String, Object>> out = new LinkedHashMap<>();
    for (Map<String, Object> t : db.query("SELECT * FROM agent_types ORDER BY sort_order, name")) {
      out.put((String) t.get("type_key"), J.map("key", t.get("type_key"), "name", t.get("name"), "icon", t.get("icon"),
          "description", t.get("description"), "role", t.get("role"), "greeting", t.get("greeting"),
          "needsOwner", J.bool(t.get("needs_owner")), "defaultCalendar", J.bool(t.get("default_calendar")),
          "sortOrder", J.num(t.get("sort_order")), "active", J.bool(t.get("active")), "updatedAt", J.iso(t.get("updated_at")),
          "templates", new ArrayList<Map<String, Object>>()));
    }
    for (Map<String, Object> r : db.query("SELECT * FROM agent_templates ORDER BY sort_order, name")) {
      Map<String, Object> t = out.get((String) r.get("type_key"));
      if (t != null) templatesOf(t).add(templateCard(r));
    }
    cache = out;
    cacheAt = System.currentTimeMillis();
    return out;
  }

  @SuppressWarnings("unchecked")
  private static List<Map<String, Object>> templatesOf(Map<String, Object> type) {
    return (List<Map<String, Object>>) type.get("templates");
  }

  /** Types and templates for the app: active only (admin: everything). Fresh copies. */
  public Map<String, Object> catalog(boolean includeInactive) {
    Map<String, Object> out = new LinkedHashMap<>();
    for (var e : all().entrySet()) {
      Map<String, Object> t = e.getValue();
      if (!includeInactive && !J.bool(t.get("active"))) continue;
      Map<String, Object> copy = new LinkedHashMap<>(t);
      copy.put("templates", templatesOf(t).stream().filter(x -> includeInactive || J.bool(x.get("active"))).map(LinkedHashMap::new).toList());
      out.put(e.getKey(), copy);
    }
    return out;
  }

  public Map<String, Object> type(String key) {
    return key == null ? null : all().get(key);
  }

  public Map<String, Object> template(String id) {
    if (J.blank(id)) return null;
    for (Map<String, Object> t : all().values()) {
      for (Map<String, Object> tp : templatesOf(t)) if (id.equals(tp.get("id"))) return tp;
    }
    return null;
  }

  /** An active type key, or "other". */
  public String validType(Object key) {
    Map<String, Object> t = type(J.str(key));
    return t != null && J.bool(t.get("active")) ? (String) t.get("key") : "other";
  }

  /** The template pre-selected for a new agent of this type (or null = free conversation). */
  public String defaultTemplateId(String typeKey) {
    Map<String, Object> t = type(typeKey);
    if (t == null) return null;
    return templatesOf(t).stream().filter(x -> J.bool(x.get("active")) && J.bool(x.get("isDefault")))
        .map(x -> (String) x.get("id")).findFirst().orElse(null);
  }

  /** templateId if it is an active template of this type, else null. */
  public String validTemplate(Object templateId, String typeKey) {
    Map<String, Object> tp = template(J.str(templateId));
    return tp != null && J.bool(tp.get("active")) && typeKey.equals(tp.get("type")) ? (String) tp.get("id") : null;
  }

  // ---------- prompt pieces for one agent ----------

  public static String render(String text, Map<String, String> vars) {
    if (text == null || text.isEmpty()) return "";
    Matcher m = OPTIONAL.matcher(text);
    StringBuilder sb = new StringBuilder();
    while (m.find()) {
      String inner = m.group(1);
      Matcher v = VAR.matcher(inner);
      boolean keep = true;
      while (v.find()) if (vars.getOrDefault(v.group(1), "").isEmpty()) keep = false;
      m.appendReplacement(sb, Matcher.quoteReplacement(keep ? inner : ""));
    }
    m.appendTail(sb);
    Map<String, String> fallback = Map.of("agent", "the assistant", "owner", "the person you work for", "org", "the company");
    Matcher v = VAR.matcher(sb.toString());
    StringBuilder out = new StringBuilder();
    while (v.find()) {
      String val = vars.getOrDefault(v.group(1), "");
      v.appendReplacement(out, Matcher.quoteReplacement(val.isEmpty() ? fallback.get(v.group(1)) : val));
    }
    v.appendTail(out);
    return out.toString().replaceAll("[ \\t]{2,}", " ").trim();
  }

  public static Map<String, String> vars(Map<String, Object> agent, String nameOverride) {
    String name = J.blank(nameOverride) ? J.str(agent == null ? null : agent.get("name")) : J.str(nameOverride);
    return Map.of("agent", name, "owner", agent == null ? "" : J.str(agent.get("owner_name")), "org", agent == null ? "" : J.str(agent.get("organization")));
  }

  private Map<String, Object> agentTemplate(Map<String, Object> agent) {
    Map<String, Object> tp = agent == null ? null : template(J.str(agent.get("template_id")));
    return tp != null && J.bool(tp.get("active")) ? tp : null;
  }

  /** The role / script part of the system prompt. A user's own playbook wins over the agent's template. */
  public String rolePrompt(Map<String, Object> agent, Map<String, Object> pb, String nameOverride) {
    Map<String, String> v = vars(agent, nameOverride);
    List<String> lines = new ArrayList<>();
    boolean demo = true;
    Map<String, Object> tp = agentTemplate(agent);
    Map<String, Object> type = agent == null ? null : type(J.str(agent.get("agent_type")));
    if (pb != null) {
      lines.add("Your role: " + render(J.str(pb.get("role")), v) + ".");
      lines.add("Playbook: " + pb.get("name") + ".");
      lines.add("Your goal: " + render(J.str(pb.get("goal")), v));
      addList(lines, "How to run the call (follow naturally, not robotically):", J.strings(pb.get("steps")), v, true);
      addList(lines, "Rules:", J.strings(pb.get("rules")), v, false);
    } else if (tp != null) {
      String role = J.blank(tp.get("role")) && type != null ? J.str(type.get("role")) : J.str(tp.get("role"));
      lines.add("Your role: " + render(role, v) + ".");
      lines.add("Script: " + tp.get("name") + ".");
      lines.add("Your goal: " + render(J.str(tp.get("goal")), v));
      addList(lines, "How to run the call (follow naturally, not robotically):", J.strings(tp.get("steps")), v, true);
      addList(lines, "Rules:", J.strings(tp.get("rules")), v, false);
    } else if (type != null && !"personal".equals(type.get("key")) && !J.blank(type.get("role"))) {
      lines.add("Your role: " + render(J.str(type.get("role")), v) + " (" + type.get("name") + "). There's no fixed script: help with whatever "
          + "the caller needs in that role, collect the details that matter and confirm them back.");
    } else {
      lines.add("Your role: a friendly, capable voice agent. There's no special script: help with whatever the caller needs, like a smart friend on the phone.");
      demo = false;
    }
    String owner = v.get("owner"), org = v.get("org");
    if (!owner.isEmpty()) lines.add("You work for " + owner + (org.isEmpty() ? "" : " at " + org) + ". Callers are calling " + owner + "; you answer on " + owner + "'s behalf.");
    else if (!org.isEmpty()) lines.add("You work for " + org + ".");
    String avail = agent == null ? "" : J.str(agent.get("owner_availability"));
    if (!avail.isEmpty()) lines.add((owner.isEmpty() ? "Availability" : owner + "'s availability") + " (use it when suggesting meeting times): " + avail);
    String about = agent == null ? "" : J.str(agent.get("description"));
    if (!about.isEmpty()) lines.add("What this agent is for: " + about);
    if (demo) lines.add("This is a demo with no live systems: collect details, confirm them back, and say they're noted or done.");
    return String.join("\n", lines);
  }

  private static void addList(List<String> lines, String title, List<String> items, Map<String, String> v, boolean numbered) {
    if (items.isEmpty()) return;
    lines.add(title);
    for (int i = 0; i < items.size(); i++) lines.add((numbered ? (i + 1) + ". " : "- ") + render(items.get(i), v));
  }

  /** First line of every call: the agent's own greeting, else its template's, else its type's. */
  public String greeting(Map<String, Object> agent, String nameOverride) {
    if (agent == null) return "";
    Map<String, String> v = vars(agent, nameOverride);
    if (!J.blank(agent.get("greeting"))) return render(J.str(agent.get("greeting")), v);
    Map<String, Object> tp = agentTemplate(agent);
    if (tp != null && !J.blank(tp.get("greeting"))) return render(J.str(tp.get("greeting")), v);
    Map<String, Object> type = type(J.str(agent.get("agent_type")));
    return type == null ? "" : render(J.str(type.get("greeting")), v);
  }

  /** What the call summary should focus on. */
  public String summaryFocus(Map<String, Object> agent, Map<String, Object> pb) {
    if (pb != null && !J.blank(pb.get("summary"))) return J.str(pb.get("summary"));
    Map<String, Object> tp = agentTemplate(agent);
    if (tp != null && !J.blank(tp.get("summary"))) return render(J.str(tp.get("summary")), vars(agent, null));
    return null;
  }

  // ---------- admin: edit types and templates ----------

  private static List<String> lines(Object v) {
    List<String> out = new ArrayList<>();
    List<Object> src = v instanceof List<?> ? J.list(v) : new ArrayList<>(List.of((Object[]) J.str(v).split("\n")));
    for (Object o : src) {
      String s = J.str(o, 300);
      if (!s.isEmpty() && out.size() < 15) out.add(s);
    }
    return out;
  }

  /** Create (key == null) or update an agent type. */
  public Map<String, Object> saveType(String key, Map<String, Object> in, String userId) {
    Map<String, Object> cur;
    if (key == null) {
      key = J.str(in.get("key")).toLowerCase().replaceAll("[^a-z0-9_]+", "_");
      if (key.isEmpty()) key = J.str(in.get("name")).toLowerCase().replaceAll("[^a-z0-9]+", "_").replaceAll("^_|_$", "");
      if (key.length() > 30) key = key.substring(0, 30);
      if (!TYPE_KEY.matcher(key).matches()) throw ApiException.bad("Key: 2–30 lowercase letters, numbers or _ (starting with a letter).");
      if (type(key) != null) throw ApiException.bad("A type with the key \"" + key + "\" already exists.");
      if (J.blank(in.get("name"))) throw ApiException.bad("Give the type a name.");
      long sort = db.count("SELECT COALESCE(MAX(sort_order), 0) + 10 FROM agent_types");
      db.exec("INSERT INTO agent_types (type_key, name, sort_order, updated_by) VALUES (?, ?, ?, ?)", key, J.str(in.get("name"), 60), sort, userId);
      cur = J.map("sortOrder", sort);
    } else {
      cur = type(key);
      if (cur == null) throw ApiException.notFound("Agent type not found.");
    }
    String name = pick(in, cur, "name", 60);
    if (name.isEmpty()) throw ApiException.bad("Give the type a name.");
    db.exec("UPDATE agent_types SET name = ?, icon = ?, description = ?, role = ?, greeting = ?, needs_owner = ?, default_calendar = ?, "
            + "sort_order = ?, active = ?, updated_by = ? WHERE type_key = ?",
        name, pickOr(in, cur, "icon", 16, "✨"), pick(in, cur, "description", 300), pick(in, cur, "role", 300),
        pick(in, cur, "greeting", 400), flag(in, cur, "needsOwner", false) ? 1 : 0, flag(in, cur, "defaultCalendar", false) ? 1 : 0,
        in.containsKey("sortOrder") ? J.num(in.get("sortOrder")) : J.num(cur.get("sortOrder")),
        flag(in, cur, "active", true) ? 1 : 0, userId, key);
    invalidate();
    return J.obj(catalog(true).get(key));
  }

  public Map<String, Object> saveTemplate(String id, Map<String, Object> in, String userId) {
    boolean create = id == null;
    Map<String, Object> cur = create ? J.map() : template(id);
    if (cur == null) throw ApiException.notFound("Template not found.");
    String typeKey = create ? J.str(in.get("type")) : J.str(in.getOrDefault("type", cur.get("type")));
    if (type(typeKey) == null) throw ApiException.bad("Pick the agent type this template belongs to.");
    String name = J.str(pick(in, cur, "name", 60));
    String goal = J.str(pick(in, cur, "goal", 400));
    if (name.isEmpty() || goal.isEmpty()) throw ApiException.bad("A template needs a name and a goal.");
    if (create) {
      String base = typeKey + "-" + name.toLowerCase().replaceAll("[^a-z0-9]+", "-").replaceAll("^-|-$", "");
      if (base.length() > 34) base = base.substring(0, 34);
      id = template(base) == null ? base : base + "-" + J.newId().substring(0, 4);
      db.exec("INSERT INTO agent_templates (id, type_key, name, goal, steps, rules, sort_order, updated_by) VALUES (?, ?, ?, ?, '[]', '[]', ?, ?)",
          id, typeKey, name, goal, db.count("SELECT COALESCE(MAX(sort_order), 0) + 10 FROM agent_templates WHERE type_key = ?", typeKey), userId);
    }
    boolean isDefault = flag(in, cur, "isDefault", false);
    final String tid = id;
    db.tx(() -> {
      if (isDefault) db.exec("UPDATE agent_templates SET is_default = 0 WHERE type_key = ? AND id <> ?", typeKey, tid);
      db.exec("UPDATE agent_templates SET type_key = ?, name = ?, role = ?, greeting = ?, goal = ?, steps = ?, rules = ?, summary_focus = ?, "
              + "is_default = ?, sort_order = ?, active = ?, updated_by = ? WHERE id = ?",
          typeKey, name, pick(in, cur, "role", 300), pick(in, cur, "greeting", 400), goal,
          J.json(in.containsKey("steps") ? lines(in.get("steps")) : cur.getOrDefault("steps", List.of())),
          J.json(in.containsKey("rules") ? lines(in.get("rules")) : cur.getOrDefault("rules", List.of())),
          pick(in, cur, "summary", 300), isDefault ? 1 : 0,
          in.containsKey("sortOrder") ? J.num(in.get("sortOrder")) : J.num(cur.getOrDefault("sortOrder", db.count("SELECT sort_order FROM agent_templates WHERE id = ?", tid))),
          flag(in, cur, "active", true) ? 1 : 0, userId, tid);
    });
    invalidate();
    return template(id);
  }

  /** Delete a template; agents using it go back to their type's free conversation. */
  public Map<String, Object> deleteTemplate(String id) {
    Map<String, Object> tp = template(id);
    if (tp == null) throw ApiException.notFound("Template not found.");
    db.tx(() -> {
      db.exec("UPDATE agents SET template_id = NULL WHERE template_id = ?", id);
      db.exec("DELETE FROM agent_templates WHERE id = ?", id);
    });
    invalidate();
    return tp;
  }

  public long agentsUsingTemplate(String id) {
    return db.count("SELECT COUNT(*) FROM agents WHERE template_id = ?", id);
  }

  private static String pick(Map<String, Object> in, Map<String, Object> cur, String k, int max) {
    return in.containsKey(k) ? J.str(in.get(k), max) : J.str(cur.get(k), max);
  }

  private static String pickOr(Map<String, Object> in, Map<String, Object> cur, String k, int max, String dflt) {
    String s = pick(in, cur, k, max);
    return s.isEmpty() ? dflt : s;
  }

  private static boolean flag(Map<String, Object> in, Map<String, Object> cur, String k, boolean dflt) {
    if (in.containsKey(k)) return J.bool(in.get(k));
    return cur.containsKey(k) ? J.bool(cur.get(k)) : dflt;
  }
}
