package com.telemune.smartai.service;

import com.telemune.smartai.db.Db;
import com.telemune.smartai.util.J;
import com.telemune.smartai.web.ApiException;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Messages callers leave with an agent (table messages), e.g. "Tell DJ that Rahul called about the contract". */
@Service
public class MessageService {
  private final Db db;

  public MessageService(Db db) {
    this.db = db;
  }

  private static Map<String, Object> fromRow(Map<String, Object> r) {
    return J.map("id", r.get("id"), "agentId", r.get("agent_id"), "agentName", r.get("agent_name"), "forName", r.get("for_name"),
        "callerName", r.get("caller_name"), "callerNumber", r.get("caller_number"), "urgency", r.get("urgency"),
        "message", r.get("message"), "status", r.get("status"), "createdAt", J.iso(r.get("created_at")), "doneAt", J.iso(r.get("done_at")));
  }

  /** Newest first. agentId / status are optional filters. */
  public Map<String, Object> list(String userId, String agentId, String status, int limit) {
    StringBuilder where = new StringBuilder("user_id = ?");
    List<Object> args = new ArrayList<>(List.of(userId));
    if (agentId != null) { where.append(" AND agent_id = ?"); args.add(agentId); }
    if (status != null) { where.append(" AND status = ?"); args.add(status); }
    long newCount = db.count("SELECT COUNT(*) FROM messages WHERE user_id = ?" + (agentId != null ? " AND agent_id = ?" : "") + " AND status = 'new'",
        agentId != null ? new Object[]{userId, agentId} : new Object[]{userId});
    args.add(limit);
    List<Map<String, Object>> rows = db.query("SELECT * FROM messages WHERE " + where + " ORDER BY status = 'new' DESC, created_at DESC LIMIT ?", args.toArray());
    return J.map("items", rows.stream().map(MessageService::fromRow).toList(), "newCount", newCount);
  }

  public long newCount(String userId) {
    return db.count("SELECT COUNT(*) FROM messages WHERE user_id = ? AND status = 'new'", userId);
  }

  public Map<String, Object> add(Map<String, Object> in, String userId, Map<String, Object> agent) {
    String message = J.str(in.get("message"), 1000);
    if (message.isEmpty()) throw ApiException.bad("The message is empty.");
    String urgency = J.str(in.get("urgency")).toLowerCase().startsWith("urg") ? "urgent" : "normal";
    String id = J.newId();
    db.exec("INSERT INTO messages (id, user_id, agent_id, agent_name, for_name, caller_name, caller_number, urgency, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        id, userId, agent == null ? null : agent.get("id"), agent == null ? "" : J.str(agent.get("name"), 40),
        agent == null ? "" : J.str(agent.get("owner_name"), 60), J.str(in.get("callerName"), 80),
        J.str(in.get("callerNumber"), 30).replaceAll("[^\\d+*# ()-]", ""), urgency, message);
    return fromRow(db.one("SELECT * FROM messages WHERE id = ?", id));
  }

  public Map<String, Object> setStatus(String id, Object status, String userId) {
    Map<String, Object> m = db.one("SELECT * FROM messages WHERE id = ? AND user_id = ?", J.str(id, 16), userId);
    if (m == null) throw ApiException.notFound("Message not found.");
    boolean done = "done".equals(J.str(status));
    db.exec("UPDATE messages SET status = ?, done_at = " + (done ? "UTC_TIMESTAMP(3)" : "NULL") + " WHERE id = ?", done ? "done" : "new", m.get("id"));
    return fromRow(db.one("SELECT * FROM messages WHERE id = ?", m.get("id")));
  }

  public Map<String, Object> delete(String id, String userId) {
    Map<String, Object> m = db.one("SELECT * FROM messages WHERE id = ? AND user_id = ?", J.str(id, 16), userId);
    if (m == null) return null;
    db.exec("DELETE FROM messages WHERE id = ?", m.get("id"));
    return fromRow(m);
  }
}
