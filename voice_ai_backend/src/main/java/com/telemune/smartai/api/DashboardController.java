package com.telemune.smartai.api;

import com.telemune.smartai.db.Db;
import com.telemune.smartai.service.AuthService;
import com.telemune.smartai.util.J;
import com.telemune.smartai.web.ApiException;
import com.telemune.smartai.web.Ctx;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 📊 Dashboard (the user's start page): everything about the signed-in user's agents for the last 7, 30 or 90 days in
 * one request. GET /api/dashboard?days=30&agent=all|<agentId>&tz=<minutes east of UTC, e.g. 330 for IST>.
 * Days and the weekday × hour grid are in the browser's time zone. Admins may read a user's with ?as=<userId>.
 */
@RestController
public class DashboardController {
  private static final Logger log = LoggerFactory.getLogger(DashboardController.class);
  private static final List<String> CHANNELS = List.of("call", "chat", "voice", "whatsapp");
  /** intents that say nothing about why someone got in touch */
  private static final Set<String> SKIP_INTENTS = Set.of("end call", "greeting", "greet", "no response", "small talk", "goodbye", "unknown", "none", "other");

  private final Db db;

  public DashboardController(Db db) {
    this.db = db;
  }

  private static LocalDateTime dt(Object v) {
    if (v instanceof LocalDateTime d) return d;
    if (v instanceof Timestamp t) return t.toLocalDateTime();
    return null;
  }

  @GetMapping("/api/dashboard")
  Map<String, Object> dashboard(@RequestAttribute("ctx") Ctx ctx, @RequestParam(defaultValue = "30") int days,
                                @RequestParam(defaultValue = "all") String agent, @RequestParam(defaultValue = "0") int tz) {
    if (!AuthService.can(ctx.user, "dashboard")) throw ApiException.forbidden("The dashboard isn't open for your account.");
    long t0 = System.nanoTime();
    int d = days <= 7 ? 7 : days <= 30 ? 30 : 90;
    int off = Math.max(-840, Math.min(840, tz));
    String uid = ctx.dataUserId;

    List<Map<String, Object>> agentRows = db.query("SELECT a.id, a.name, a.agent_type, a.owner_name, a.organization, a.is_default, a.language, "
        + "COALESCE(t.name, a.agent_type) AS type_name, COALESCE(t.icon, '✨') AS type_icon FROM agents a "
        + "LEFT JOIN agent_types t ON t.type_key = a.agent_type WHERE a.user_id = ? ORDER BY a.is_default DESC, a.created_at", uid);
    String agentId = null;
    if (!"all".equals(agent) && !J.blank(agent)) {
      if (agentRows.stream().noneMatch(a -> agent.equals(a.get("id")))) throw ApiException.notFound("Agent not found.");
      agentId = agent;
    }
    String aCond = agentId == null ? "" : " AND agent_id = ?";

    LocalDateTime now = J.nowUtc();
    LocalDate today = now.plusMinutes(off).toLocalDate();
    LocalDate firstDay = today.minusDays(d - 1);
    LocalDateTime from = firstDay.atStartOfDay().minusMinutes(off);          // start of the first local day, in UTC
    LocalDateTime prevFrom = from.minusDays(d);

    List<Object> args = new ArrayList<>(List.of(uid, prevFrom));
    if (agentId != null) args.add(agentId);
    List<Map<String, Object>> calls = db.query("SELECT id, agent_id, agent_name, channel, started_at, duration_seconds, turns, tokens_total, avg_response_ms, "
        + "ended_by, JSON_EXTRACT(stats, '$.intents') AS intents FROM calls WHERE user_id = ? AND started_at >= ?" + aCond + " ORDER BY started_at", args.toArray());

    // ---- per day, per channel; totals for this period and the one before ----
    Map<LocalDate, long[]> perDay = new LinkedHashMap<>();       // [call, chat, voice, whatsapp, replySum, replyN, seconds, tokens]
    for (int i = 0; i < d; i++) perDay.put(firstDay.plusDays(i), new long[8]);
    long[] cur = new long[6], prev = new long[6];                  // [conversations, seconds, tokens, replySum, replyN, turns]
    long[][] heat = new long[7][24];
    Map<String, Long> intents = new HashMap<>(), ends = new LinkedHashMap<>();
    Map<String, long[]> perAgent = new HashMap<>();               // [count, replySum, replyN]
    Map<String, long[]> perAgentDay = new HashMap<>();
    Map<String, LocalDateTime> lastAt = new HashMap<>();
    for (Map<String, Object> c : calls) {
      LocalDateTime at = dt(c.get("started_at"));
      if (at == null) continue;
      boolean now_ = !at.isBefore(from);
      long[] tot = now_ ? cur : prev;
      Long reply = J.numOrNull(c.get("avg_response_ms"));
      tot[0]++; tot[1] += J.num(c.get("duration_seconds")); tot[2] += J.num(c.get("tokens_total")); tot[5] += J.num(c.get("turns"));
      if (reply != null && reply > 0) { tot[3] += reply; tot[4]++; }
      if (!now_) continue;
      LocalDateTime local = at.plusMinutes(off);
      long[] day = perDay.get(local.toLocalDate());
      int ch = Math.max(0, CHANNELS.indexOf(J.str(c.get("channel"))));
      if (day != null) { day[ch]++; day[6] += J.num(c.get("duration_seconds")); day[7] += J.num(c.get("tokens_total")); if (reply != null && reply > 0) { day[4] += reply; day[5]++; } }
      heat[local.getDayOfWeek().getValue() - 1][local.getHour()]++;
      if (!"whatsapp".equals(c.get("channel"))) ends.merge(J.str(c.get("ended_by"), 40).toLowerCase(Locale.ROOT), 1L, Long::sum);
      for (String it : J.strings(J.parse(c.get("intents")))) {
        String k = it.trim().toLowerCase(Locale.ROOT).replaceAll("\\s+", " ");
        if (k.length() > 1 && !SKIP_INTENTS.contains(k)) intents.merge(k.length() > 60 ? k.substring(0, 60) : k, 1L, Long::sum);
      }
      String aid = J.str(c.get("agent_id"));
      if (!aid.isEmpty()) {
        long[] pa = perAgent.computeIfAbsent(aid, k -> new long[3]);
        pa[0]++; if (reply != null && reply > 0) { pa[1] += reply; pa[2]++; }
        long[] spark = perAgentDay.computeIfAbsent(aid, k -> new long[d]);
        int idx = (int) (local.toLocalDate().toEpochDay() - firstDay.toEpochDay());
        if (idx >= 0 && idx < d) spark[idx]++;
        lastAt.merge(aid, at, (x, y) -> x.isAfter(y) ? x : y);
      }
    }

    // ---- meetings and messages created in each period ----
    List<Object> a2 = new ArrayList<>(List.of(from, from, uid, prevFrom));
    if (agentId != null) a2.add(agentId);
    String split = "SELECT COALESCE(SUM(created_at >= ?), 0) AS cur, COALESCE(SUM(created_at < ?), 0) AS prev FROM ";
    Map<String, Object> mt = db.one(split + "calendar_events WHERE user_id = ? AND created_at >= ?" + aCond, a2.toArray());
    Map<String, Object> ms = db.one(split + "messages WHERE user_id = ? AND created_at >= ?" + aCond, a2.toArray());
    Map<String, Long> meetingsBy = new HashMap<>();
    for (Map<String, Object> r : db.query("SELECT agent_id, COUNT(*) AS n FROM calendar_events WHERE user_id = ? AND created_at >= ? GROUP BY agent_id", uid, from))
      meetingsBy.put(J.str(r.get("agent_id")), J.num(r.get("n")));

    // ---- lists ----
    List<Object> a3 = new ArrayList<>(List.of(uid, now));
    if (agentId != null) a3.add(agentId);
    List<Map<String, Object>> upcoming = db.query("SELECT e.id, e.title, e.start_at, e.duration_min, a.name AS agent FROM calendar_events e LEFT JOIN agents a ON a.id = e.agent_id "
        + "WHERE e.user_id = ? AND e.start_at >= ?" + aCond.replace("agent_id", "e.agent_id") + " ORDER BY e.start_at LIMIT 5", a3.toArray());
    List<Object> a4 = new ArrayList<>(List.of(uid));
    if (agentId != null) a4.add(agentId);
    List<Map<String, Object>> msgs = db.query("SELECT id, caller_name, caller_number, urgency, message, status, agent_name, created_at FROM messages WHERE user_id = ?" + aCond
        + " ORDER BY (status = 'new') DESC, created_at DESC LIMIT 5", a4.toArray());
    long newMsgs = db.count("SELECT COUNT(*) FROM messages WHERE user_id = ? AND status = 'new'" + aCond, a4.toArray());
    List<Map<String, Object>> recent = new ArrayList<>(calls.subList(Math.max(0, calls.size() - 5), calls.size()));
    java.util.Collections.reverse(recent);

    // ---- shape it ----
    List<Map<String, Object>> daily = new ArrayList<>();
    perDay.forEach((day, v) -> daily.add(J.map("date", day.toString(), "call", v[0], "chat", v[1], "voice", v[2], "whatsapp", v[3],
        "avgReplyMs", v[5] == 0 ? null : v[4] / v[5], "seconds", v[6], "tokens", v[7])));
    List<Map<String, Object>> agentsOut = new ArrayList<>();
    for (Map<String, Object> a : agentRows) {
      String id = (String) a.get("id");
      if (agentId != null && !agentId.equals(id)) continue;
      long[] pa = perAgent.getOrDefault(id, new long[3]);
      long[] sp = perAgentDay.getOrDefault(id, new long[d]);
      List<Long> spark = new ArrayList<>(); for (long x : sp) spark.add(x);
      agentsOut.add(J.map("id", id, "name", a.get("name"), "type", a.get("type_name"), "icon", a.get("type_icon"), "owner", a.get("owner_name"),
          "organization", a.get("organization"), "isDefault", J.bool(a.get("is_default")), "language", a.get("language"),
          "conversations", pa[0], "avgReplyMs", pa[2] == 0 ? null : pa[1] / pa[2], "meetings", meetingsBy.getOrDefault(id, 0L),
          "spark", spark, "lastAt", J.iso(lastAt.get(id))));
    }
    List<? extends Map<String, Object>> intentsOut = intents.entrySet().stream().sorted((x, y) -> Long.compare(y.getValue(), x.getValue())).limit(6)
        .map(e -> J.map("label", e.getKey(), "count", e.getValue())).toList();
    List<? extends Map<String, Object>> endsOut = ends.entrySet().stream().sorted((x, y) -> Long.compare(y.getValue(), x.getValue())).limit(5)
        .map(e -> J.map("label", e.getKey(), "count", e.getValue())).toList();
    List<List<Long>> heatOut = new ArrayList<>();
    for (long[] row : heat) { List<Long> r = new ArrayList<>(); for (long x : row) r.add(x); heatOut.add(r); }

    Map<String, Object> out = J.map("days", d, "from", firstDay.toString(), "to", today.toString(),
        "totals", totals(cur, J.num(mt == null ? null : mt.get("cur")), J.num(ms == null ? null : ms.get("cur"))),
        "previous", totals(prev, J.num(mt == null ? null : mt.get("prev")), J.num(ms == null ? null : ms.get("prev"))),
        "daily", daily, "heat", heatOut, "intents", intentsOut, "ends", endsOut, "agents", agentsOut,
        "agentCount", agentRows.size(),
        "upcoming", upcoming.stream().map(e -> J.map("id", e.get("id"), "title", e.get("title"), "startAt", J.iso(e.get("start_at")),
            "minutes", J.num(e.get("duration_min")), "agent", e.get("agent"))).toList(),
        "messages", msgs.stream().map(m -> J.map("id", m.get("id"), "callerName", m.get("caller_name"), "callerNumber", m.get("caller_number"),
            "urgency", m.get("urgency"), "message", m.get("message"), "status", m.get("status"), "agent", m.get("agent_name"),
            "at", J.iso(m.get("created_at")))).toList(),
        "newMessages", newMsgs,
        "recent", recent.stream().map(c -> J.map("id", c.get("id"), "channel", c.get("channel"), "agent", c.get("agent_name"),
            "at", J.iso(c.get("started_at")), "seconds", J.num(c.get("duration_seconds")), "turns", J.num(c.get("turns")),
            "endedBy", c.get("ended_by"), "intent", J.strings(J.parse(c.get("intents"))).stream().filter(s -> !SKIP_INTENTS.contains(s.trim().toLowerCase(Locale.ROOT))).findFirst().orElse(null))).toList());
    log.debug("Dashboard for {} ({} days, agent {}): {} conversations in {} ms", uid, d, agentId == null ? "all" : agentId, cur[0], (System.nanoTime() - t0) / 1_000_000);
    return out;
  }

  private static Map<String, Object> totals(long[] t, long meetings, long messages) {
    return J.map("conversations", t[0], "seconds", t[1], "tokens", t[2], "avgReplyMs", t[4] == 0 ? null : t[3] / t[4], "turns", t[5],
        "meetings", meetings, "messages", messages);
  }
}
