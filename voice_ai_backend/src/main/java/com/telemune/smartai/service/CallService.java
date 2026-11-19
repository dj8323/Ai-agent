package com.telemune.smartai.service;

import com.telemune.smartai.db.Db;
import com.telemune.smartai.util.J;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/** Call history (tables calls + call_summaries). Recordings stay on disk: data/users/<userId>/recordings/. */
@Service
public class CallService {
  private static final Pattern SAFE_ID = Pattern.compile("^[a-zA-Z0-9-]{1,16}$");
  private static final Map<String, String> REC_TYPES = Map.of("audio/webm", "webm", "audio/mp4", "m4a", "audio/ogg", "ogg");
  private static final String SELECT = "SELECT c.*, s.summary FROM calls c LEFT JOIN call_summaries s ON s.call_id = c.id";
  private final Db db;
  private final AppConfigService config;

  public CallService(Db db, AppConfigService config) {
    this.db = db;
    this.config = config;
  }

  private Path recDir(String userId) {
    if (!SAFE_ID.matcher(userId).matches()) throw new IllegalArgumentException("Bad user id");
    return config.home().resolve("data").resolve("users").resolve(userId).resolve("recordings");
  }

  private static Map<String, Object> fromRow(Map<String, Object> r, boolean withTranscript) {
    Map<String, Object> c = J.map("id", r.get("id"), "agentId", r.get("agent_id"), "agentName", r.get("agent_name"),
        "startedAt", J.iso(r.get("started_at")), "endedAt", J.iso(r.get("ended_at")), "duration", r.get("duration"),
        "endedBy", r.get("ended_by"), "channel", r.get("channel") == null ? "call" : r.get("channel"), "playbook", J.parse(r.get("playbook")), "language", r.get("language"), "voice", r.get("voice"),
        "stats", J.obj(r.get("stats")), "summary", r.get("summary") == null ? "" : r.get("summary"));
    if (withTranscript) c.put("transcript", J.list(r.get("transcript")));
    c.put("recording", r.get("recording_file") == null ? null
        : J.map("file", r.get("recording_file"), "type", r.get("recording_type"), "bytes", r.get("recording_bytes")));
    return c;
  }

  public static final List<String> CHANNELS = List.of("call", "chat", "voice", "whatsapp");

  public Map<String, Object> list(int page, int pageSize, String agentId, String userId) {
    return list(page, pageSize, agentId, null, userId);
  }

  /** One page of records, newest first; channel = call | chat | voice | whatsapp, or null for all. */
  public Map<String, Object> list(int page, int pageSize, String agentId, String channel, String userId) {
    List<Object> a = new ArrayList<>(List.of(userId));
    String where = "c.user_id = ?";
    if (agentId != null) { where += " AND c.agent_id = ?"; a.add(agentId); }
    if (channel != null && CHANNELS.contains(channel)) { where += " AND c.channel = ?"; a.add(channel); }
    Object[] args = a.toArray();
    long total = db.count("SELECT COUNT(*) FROM calls c WHERE " + where, args);
    int pages = (int) Math.max(1, Math.ceil(total / (double) pageSize));
    int p = Math.min(Math.max(1, page), pages);
    List<Object> full = new ArrayList<>(List.of(args));
    full.add(pageSize);
    full.add((p - 1) * pageSize);
    List<Map<String, Object>> rows = db.query(SELECT + " WHERE " + where + " ORDER BY c.started_at DESC LIMIT ? OFFSET ?", full.toArray());
    return J.map("items", rows.stream().map(r -> fromRow(r, false)).toList(), "page", p, "pages", pages, "total", total, "pageSize", pageSize);
  }

  public Map<String, Object> get(String id, String userId) {
    Map<String, Object> r = db.one(SELECT + " WHERE c.id = ? AND c.user_id = ?", J.str(id, 16), userId);
    return r == null ? null : fromRow(r, true);
  }

  private static long toSeconds(String d) {
    long acc = 0;
    for (String part : d.split(":")) acc = acc * 60 + J.num(part);
    return acc;
  }

  public Map<String, Object> save(Map<String, Object> in, String userId, Map<String, Object> agent) {
    Map<String, Object> stats = J.obj(in.get("stats"));
    Map<String, Object> tk = J.obj(stats.get("tokens"));
    String id = J.newId();
    Instant started = J.parseInstant(in.get("startedAt"));
    if (started == null) started = Instant.now();
    Instant ended = Instant.now();
    String duration = J.str(in.get("duration"), 12);
    if (duration.isEmpty()) duration = "00:00";
    Map<String, Object> pbIn = J.obj(in.get("playbook"));
    Map<String, Object> playbook = pbIn.isEmpty() ? null
        : J.map("name", J.str(pbIn.get("name"), 60), "icon", J.str(pbIn.get("icon"), 8), "type", J.str(pbIn.get("type"), 30));
    List<Object> transcript = J.list(in.get("transcript"));
    if (transcript.size() > 300) transcript = transcript.subList(0, 300);
    String agentName = J.str(in.get("agentName"), 40);
    if (agentName.isEmpty() && agent != null) agentName = J.str(agent.get("name"), 40);
    Long avg = stats.get("avgResponseMs") != null ? J.numOrNull(stats.get("avgResponseMs"))
        : J.dbl(J.str(stats.get("avgResponse")).replace("s", "")) == null ? null : Math.round(J.dbl(J.str(stats.get("avgResponse")).replace("s", "")) * 1000);
    String endedBy = J.str(in.get("endedBy"), 40);
    String channel = CHANNELS.contains(J.str(in.get("channel"))) ? J.str(in.get("channel"))
        : "live chat".equals(endedBy) ? "chat" : "voice chat".equals(endedBy) ? "voice" : "call";
    Map<String, Object> call = J.map("id", id, "agentId", agent == null ? null : agent.get("id"), "agentName", agentName,
        "startedAt", started.toString(), "endedAt", ended.toString(), "duration", duration, "endedBy", endedBy.isEmpty() ? "user" : endedBy, "channel", channel,
        "playbook", playbook, "language", J.str(in.get("language"), 40), "voice", J.str(in.get("voice"), 64), "stats", stats,
        "summary", J.str(in.get("summary"), 8000), "transcript", transcript, "recording", null);
    final long secs = toSeconds(duration);
    db.tx(() -> {
      db.exec("INSERT INTO calls (id, user_id, agent_id, agent_name, started_at, ended_at, duration, duration_seconds, ended_by, channel, playbook, language, voice, "
              + "turns, tokens_input, tokens_output, tokens_total, avg_response_ms, stats, transcript) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          id, userId, call.get("agentId"), call.get("agentName"), J.utc(Instant.parse((String) call.get("startedAt"))), J.utc(ended),
          call.get("duration"), secs, call.get("endedBy"), channel, playbook == null ? null : J.json(playbook), call.get("language"), call.get("voice"),
          J.num(stats.get("turns")), J.num(tk.get("input")), J.num(tk.get("output")), J.num(tk.get("total")), avg, J.json(stats), J.json(call.get("transcript")));
      db.exec("INSERT INTO call_summaries (call_id, summary, full_text) VALUES (?, ?, ?)", id, call.get("summary"), summaryText(call));
    });
    return call;
  }

  /** A WhatsApp message sent from the call page, kept in Call summaries (channel whatsapp). */
  public Map<String, Object> saveWhatsApp(String userId, Map<String, Object> agent, String to, String message, Map<String, Object> result) {
    boolean ok = J.bool(result.get("ok"));
    String now = Instant.now().toString();
    String summary = "WhatsApp message to +" + to + " · " + (ok ? "sent" : "not sent: " + J.str(result.get("error"), 200)) + "\n\n" + message;
    Map<String, Object> in = J.map("channel", "whatsapp", "endedBy", ok ? "sent" : "not sent", "startedAt", now, "endedAt", now, "duration", "00:00",
        "agentName", agent == null ? "" : J.str(agent.get("name")), "language", "", "voice", "",
        "stats", J.map("turns", 0, "to", to, "status", ok ? "sent" : "failed", "messageId", result.get("id"), "error", result.get("error")),
        "summary", summary, "transcript", List.of(J.map("role", "agent", "text", message)));
    return save(in, userId, agent);
  }

  /** The permanent, human-readable summary for one call (the ⬇ .txt download). */
  public static String summaryText(Map<String, Object> c) {
    Map<String, Object> st = J.obj(c.get("stats"));
    Map<String, Object> tk = J.obj(st.get("tokens"));
    List<String> out = new ArrayList<>();
    String started = J.str(c.get("startedAt"));
    try {
      started = DateTimeFormatter.ofPattern("d MMM yyyy, HH:mm:ss").withZone(ZoneId.systemDefault()).format(Instant.parse(started));
    } catch (Exception ignored) { }
    out.add("TelemuneSmartAi · Call summary");
    out.add("Call ID: " + c.get("id"));
    out.add("Agent: " + (J.blank(c.get("agentName")) ? "?" : c.get("agentName")));
    out.add("Started: " + started);
    out.add("Playbook: " + (c.get("playbook") == null ? "Default agent" : J.obj(c.get("playbook")).get("name")));
    out.add("Duration: " + c.get("duration") + " · Turns: " + J.num(st.get("turns")) + " · Avg reply: " + or(st.get("avgResponse")) + " · Ended: " + c.get("endedBy"));
    out.add("Language: " + (J.blank(st.get("languages")) ? or(c.get("language")) : st.get("languages")) + " · Mood: " + or(st.get("moodPath")));
    out.add("Tokens: " + J.num(tk.get("total")) + " (input " + J.num(tk.get("input")) + ", output " + J.num(tk.get("output")) + ")");
    List<String> emg = J.strings(st.get("emergencies"));
    if (!emg.isEmpty()) out.add("🚨 Emergencies: " + String.join(", ", emg));
    List<String> cal = J.strings(st.get("calendarEvents"));
    if (!cal.isEmpty()) out.add("📅 Calendar events added: " + String.join(", ", cal));
    List<String> msgs = J.strings(st.get("messages"));
    if (!msgs.isEmpty()) out.add("📨 Messages taken: " + String.join(" | ", msgs));
    out.add("");
    out.add(J.blank(c.get("summary")) ? "No summary." : J.str(c.get("summary")));
    out.add("");
    out.add("--- Transcript ---");
    for (Object o : J.list(c.get("transcript"))) {
      Map<String, Object> t = J.obj(o);
      if ("caller".equals(t.get("role"))) {
        StringBuilder sb = new StringBuilder("Caller: " + J.str(t.get("text")));
        Double ms = J.dbl(t.get("responseMs"));
        sb.append("\n   [intent: ").append(or(t.get("intent"))).append(" | mood: ").append(or(t.get("mood"))).append(" | language: ")
            .append(or(t.get("lang"))).append(" | reply: ").append(ms == null ? "?" : String.format("%.1fs", ms / 1000)).append("]");
        if (!J.blank(t.get("emergency"))) sb.append("\n   🚨 EMERGENCY: ").append(J.str(t.get("emergency")));
        if (!J.blank(t.get("calendar"))) sb.append("\n   📅 Calendar: ").append(J.str(t.get("calendar")));
        if (!J.blank(t.get("message"))) sb.append("\n   📨 Message: ").append(J.str(t.get("message")));
        out.add(sb.toString());
      } else {
        List<String> em = J.strings(t.get("emotions"));
        out.add("Agent: " + J.str(t.get("text")) + (em.isEmpty() ? "" : "  (" + String.join(", ", em) + ")"));
      }
    }
    out.add("");
    return String.join("\n", out);
  }

  private static String or(Object v) {
    return J.blank(v) ? "?" : J.str(v);
  }

  public String summaryFile(String id, String userId) {
    Map<String, Object> r = db.one("SELECT s.full_text FROM call_summaries s JOIN calls c ON c.id = s.call_id WHERE c.id = ? AND c.user_id = ?", J.str(id, 16), userId);
    if (r != null) return (String) r.get("full_text");
    Map<String, Object> call = get(id, userId);
    return call == null ? null : summaryText(call);
  }

  public Map<String, Object> stats(String userId) {
    Map<String, Object> r = db.one("SELECT COUNT(*) AS calls, COALESCE(SUM(duration_seconds),0) AS totalSeconds, COALESCE(SUM(tokens_input),0) AS ti, "
        + "COALESCE(SUM(tokens_output),0) AS tout, COALESCE(SUM(tokens_total),0) AS tt, AVG(avg_response_ms) AS avgMs, "
        + "COALESCE(SUM(recording_file IS NOT NULL),0) AS recordings, COALESCE(SUM(turns),0) AS turns FROM calls WHERE user_id = ?", userId);
    Map<String, Object> byChannel = new java.util.LinkedHashMap<>();
    for (String ch : CHANNELS) byChannel.put(ch, 0L);
    for (Map<String, Object> x : db.query("SELECT channel, COUNT(*) AS n FROM calls WHERE user_id = ? GROUP BY channel", userId))
      byChannel.put(J.str(x.get("channel")), J.num(x.get("n")));
    return J.map("calls", J.num(r.get("calls")), "byChannel", byChannel, "totalSeconds", J.num(r.get("totalSeconds")),
        "tokens", J.map("input", J.num(r.get("ti")), "output", J.num(r.get("tout")), "total", J.num(r.get("tt"))),
        "avgResponseMs", J.numOrNull(r.get("avgMs")), "recordings", J.num(r.get("recordings")), "turns", J.num(r.get("turns")));
  }

  public Map<String, Object> saveRecording(String id, String contentType, byte[] data, String userId) throws IOException {
    Map<String, Object> call = get(id, userId);
    if (call == null) return null;
    String type = (contentType == null || contentType.isBlank() ? "audio/webm" : contentType).split(";")[0].trim();
    String file = call.get("id") + "." + REC_TYPES.getOrDefault(type, "webm");
    Path dir = recDir(userId);
    Files.createDirectories(dir);
    Files.write(dir.resolve(file), data);
    db.exec("UPDATE calls SET recording_file = ?, recording_type = ?, recording_bytes = ? WHERE id = ?", file, type, data.length, call.get("id"));
    return J.map("file", file, "type", type, "bytes", data.length);
  }

  public record Recording(String file, String type, byte[] data) {}

  public Recording readRecording(String id, String userId) throws IOException {
    Map<String, Object> call = get(id, userId);
    if (call == null || call.get("recording") == null) return null;
    Map<String, Object> rec = J.obj(call.get("recording"));
    Path f = recDir(userId).resolve(J.str(rec.get("file"))).normalize();
    if (!f.startsWith(recDir(userId)) || !Files.exists(f)) return null;
    return new Recording(J.str(rec.get("file")), J.str(rec.get("type")), Files.readAllBytes(f));
  }

  public Map<String, Object> delete(String id, String userId) throws IOException {
    Map<String, Object> call = get(id, userId);
    if (call == null) return null;
    if (call.get("recording") != null) {
      Path f = recDir(userId).resolve(J.str(J.obj(call.get("recording")).get("file"))).normalize();
      if (f.startsWith(recDir(userId))) Files.deleteIfExists(f);
    }
    db.exec("DELETE FROM calls WHERE id = ? AND user_id = ?", call.get("id"), userId); // summary row goes with it
    return call;
  }
}
