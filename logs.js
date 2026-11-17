// Activity log (who did what) and API request log, both in MySQL. Logging never breaks a request.
import { exec, query, one, iso } from "./db.js";
import { requestContext } from "./context.js";

/** Record an action, e.g. logActivity("agent.create", "Hospital desk", { type: "hospital" }). */
export async function logActivity(action, target = "", details = null, who = null) {
  const store = requestContext.getStore() || {};
  const user = who || store.user || null;
  try {
    await exec(
      "INSERT INTO activity_logs (user_id, username, action, target, details, ip) VALUES (?, ?, ?, ?, ?, ?)",
      [user?.id || null, user?.username || "", String(action).slice(0, 40), String(target || "").slice(0, 120),
        details == null ? null : JSON.stringify(details), String(store.ip || "").slice(0, 64)],
    );
  } catch (err) {
    console.warn("activity log failed:", err.message);
  }
}

export async function logRequest({ userId, agentId, method, path, status, ms, ip }) {
  try {
    await exec(
      "INSERT INTO api_logs (user_id, agent_id, method, path, status, duration_ms, ip) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [userId || null, agentId || null, method, String(path).slice(0, 200), status || 0, Math.round(ms), String(ip || "").slice(0, 64)],
    );
  } catch (err) {
    console.warn("api log failed:", err.message);
  }
}

/** Paginated activity log for the admin dashboard (optionally for one user). */
export async function listActivity({ page = 1, pageSize = 20, userId = null } = {}) {
  const where = userId ? "WHERE user_id = ?" : "";
  const args = userId ? [userId] : [];
  const total = (await one(`SELECT COUNT(*) AS n FROM activity_logs ${where}`, args)).n;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), pages);
  const rows = await query(
    `SELECT id, user_id, username, action, target, details, ip, created_at FROM activity_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...args, pageSize, (p - 1) * pageSize],
  );
  return {
    items: rows.map((r) => ({ id: r.id, userId: r.user_id, username: r.username, action: r.action, target: r.target, details: r.details, ip: r.ip, at: iso(r.created_at) })),
    page: p, pages, total, pageSize,
  };
}

/** Quick API numbers for the admin dashboard (last 24 hours). */
export async function apiStats() {
  const r = await one(
    `SELECT COUNT(*) AS requests, SUM(status >= 400) AS errors, ROUND(AVG(duration_ms)) AS avgMs
       FROM api_logs WHERE created_at > UTC_TIMESTAMP(3) - INTERVAL 1 DAY`,
  );
  return { requests: Number(r.requests) || 0, errors: Number(r.errors) || 0, avgMs: r.avgMs == null ? null : Number(r.avgMs) };
}
