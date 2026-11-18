package com.telemune.smartai.service;

import com.telemune.smartai.db.Db;
import com.telemune.smartai.util.J;
import com.telemune.smartai.web.ApiException;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** A user's own saved playbooks (table playbooks). Any of their agents can pick one; it wins over the agent's template. */
@Service
public class PlaybookService {
  private final Db db;
  private final TemplateService templates;

  public PlaybookService(Db db, TemplateService templates) {
    this.db = db;
    this.templates = templates;
  }

  static Map<String, Object> fromRow(Map<String, Object> r) {
    return J.map("id", r.get("id"), "type", r.get("agent_type"), "name", r.get("name"), "role", r.get("role"), "goal", r.get("goal"),
        "steps", J.strings(r.get("steps")), "rules", J.strings(r.get("rules")), "summary", r.get("summary_focus"),
        "createdAt", J.iso(r.get("created_at")));
  }

  public List<Map<String, Object>> list(String userId) {
    return db.query("SELECT * FROM playbooks WHERE user_id = ? ORDER BY created_at", userId).stream().map(PlaybookService::fromRow).toList();
  }

  public Map<String, Object> get(Object id, String userId) {
    if (J.blank(id)) return null;
    Map<String, Object> r = db.one("SELECT * FROM playbooks WHERE id = ? AND user_id = ?", J.str(id, 16), userId);
    return r == null ? null : fromRow(r);
  }

  private static List<String> cleanList(Object v) {
    List<String> out = new ArrayList<>();
    List<Object> src = v instanceof List<?> ? J.list(v) : List.of((Object[]) J.str(v).split("\n"));
    for (Object o : src) {
      String s = J.str(o, 300);
      if (!s.isEmpty() && out.size() < 12) out.add(s);
    }
    return out;
  }

  public Map<String, Object> add(Map<String, Object> in, String userId) {
    Map<String, Object> typeCard = templates.type(J.str(in.get("type")));
    String type = typeCard == null ? "other" : (String) typeCard.get("key");
    String name = J.str(in.get("name"), 60);
    String goal = J.str(in.get("goal"), 400);
    if (name.isEmpty() || goal.isEmpty()) throw ApiException.bad("Name and goal are required.");
    String role = J.str(in.get("role"), 200);
    if (role.isEmpty() && typeCard != null) role = J.str(typeCard.get("role"), 200);
    String id = J.newId();
    db.exec("INSERT INTO playbooks (id, user_id, agent_type, name, role, goal, steps, rules, summary_focus) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        id, userId, type, name, role, goal, J.json(cleanList(in.get("steps"))), J.json(cleanList(in.get("rules"))), J.str(in.get("summary"), 300));
    return get(id, userId);
  }

  public Map<String, Object> remove(String id, String userId) {
    Map<String, Object> pb = get(id, userId);
    if (pb == null) return null;
    db.exec("UPDATE agents SET playbook_id = NULL WHERE playbook_id = ? AND user_id = ?", id, userId);
    db.exec("DELETE FROM playbooks WHERE id = ? AND user_id = ?", id, userId);
    return pb;
  }
}
