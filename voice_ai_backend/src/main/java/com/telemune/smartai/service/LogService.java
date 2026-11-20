package com.telemune.smartai.service;

import com.telemune.smartai.db.Db;
import com.telemune.smartai.util.J;
import com.telemune.smartai.web.Ctx;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

/** Activity log (who did what) and API request log, both in MySQL. Logging never breaks a request. */
@Service
public class LogService {
  private static final Logger log = LoggerFactory.getLogger(LogService.class);
  private final Db db;

  public LogService(Db db) {
    this.db = db;
  }

  /** e.g. activity(ctx, "agent.create", "Hospital desk", Map.of("type", "hospital")). */
  public void activity(Ctx ctx, String action, String target, Object details) {
    activity(ctx, action, target, details, ctx == null ? null : ctx.userId(), ctx == null ? "" : ctx.username());
  }

  public void activity(Ctx ctx, String action, String target, Object details, String userId, String username) {
    try {
      log.info("Activity {} \"{}\" by {} {}", action, target, username == null || username.isEmpty() ? "-" : username,
          details == null ? "" : J.json(details));
      db.exec("INSERT INTO activity_logs (request_id, user_id, username, action, target, details, ip) VALUES (?, ?, ?, ?, ?, ?, ?)",
          ctx == null ? null : ctx.requestId, userId, J.str(username, 64), J.str(action, 40), J.str(target, 120), details == null ? null : J.json(details),
          ctx == null ? "" : J.str(ctx.ip, 64));
    } catch (Exception e) {
      log.warn("Could not write activity_logs: {}", e.getMessage());
    }
  }

  public void request(Ctx ctx, String method, String path, int status, long ms) {
    try {
      db.exec("INSERT INTO api_logs (request_id, user_id, agent_id, method, path, status, duration_ms, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          ctx.requestId, ctx.userId(), ctx.agentId(), method, J.str(path, 200), status, ms, J.str(ctx.ip, 64));
    } catch (Exception e) {
      log.warn("Could not write api_logs: {}", e.getMessage());
    }
  }

  /** Paginated activity log for the admin dashboard (optionally for one user). */
  public Map<String, Object> listActivity(int page, int pageSize, String userId) {
    return listActivity(page, pageSize, userId, null);
  }

  /**
   * kind: "user" = what people did in the app (agents, calls, chats, messages, playbooks, WhatsApp…), "auth" = sign-ins and
   * passwords, "admin" = accounts, settings, templates and server changes; null = everything.
   */
  public Map<String, Object> listActivity(int page, int pageSize, String userId, String kind) {
    List<String> conds = new java.util.ArrayList<>();
    List<Object> argList = new java.util.ArrayList<>();
    if (userId != null) { conds.add("user_id = ?"); argList.add(userId); }
    String adminActs = "(action LIKE 'user.%' OR action LIKE 'type.%' OR action LIKE 'template.%' OR action LIKE 'server.%' OR action = 'config.update')";
    if ("auth".equals(kind)) conds.add("action LIKE 'auth.%'");
    else if ("admin".equals(kind)) conds.add(adminActs);
    else if ("user".equals(kind)) conds.add("action NOT LIKE 'auth.%' AND NOT " + adminActs);
    String where = conds.isEmpty() ? "" : "WHERE " + String.join(" AND ", conds);
    Object[] args = argList.toArray();
    long total = db.count("SELECT COUNT(*) FROM activity_logs " + where, args);
    int pages = (int) Math.max(1, Math.ceil(total / (double) pageSize));
    int p = Math.min(Math.max(1, page), pages);
    argList.add(pageSize); argList.add((p - 1) * pageSize);
    Object[] full = argList.toArray();
    List<Map<String, Object>> rows = db.query(
        "SELECT id, user_id, username, action, target, details, ip, created_at FROM activity_logs " + where + " ORDER BY id DESC LIMIT ? OFFSET ?", full);
    return J.map("items", rows.stream().map(r -> J.map("id", r.get("id"), "userId", r.get("user_id"), "username", r.get("username"),
        "action", r.get("action"), "target", r.get("target"), "details", J.parse(r.get("details")), "ip", r.get("ip"),
        "at", J.iso(r.get("created_at")))).toList(), "page", p, "pages", pages, "total", total, "pageSize", pageSize);
  }

  /** Sign-in attempts (ok and failed), newest first. */
  public Map<String, Object> listLogins(int page, int pageSize) {
    long total = db.count("SELECT COUNT(*) FROM login_attempts");
    int pages = (int) Math.max(1, Math.ceil(total / (double) pageSize));
    int p = Math.min(Math.max(1, page), pages);
    List<Map<String, Object>> rows = db.query(
        "SELECT id, username, user_id, ip, user_agent, success, reason, created_at FROM login_attempts ORDER BY id DESC LIMIT ? OFFSET ?",
        pageSize, (p - 1) * pageSize);
    return J.map("items", rows.stream().map(r -> J.map("id", r.get("id"), "username", r.get("username"), "userId", r.get("user_id"),
        "ip", r.get("ip"), "userAgent", r.get("user_agent"), "success", J.bool(r.get("success")), "reason", r.get("reason"),
        "at", J.iso(r.get("created_at")))).toList(), "page", p, "pages", pages, "total", total, "pageSize", pageSize);
  }

  /** Quick API numbers for the admin dashboard (last 24 hours). */
  public Map<String, Object> apiStats() {
    Map<String, Object> r = db.one("SELECT COUNT(*) AS requests, SUM(status >= 400) AS errors, ROUND(AVG(duration_ms)) AS avgMs "
        + "FROM api_logs WHERE created_at > UTC_TIMESTAMP(3) - INTERVAL 1 DAY");
    return J.map("requests", J.num(r.get("requests")), "errors", J.num(r.get("errors")), "avgMs", J.numOrNull(r.get("avgMs")));
  }
}
