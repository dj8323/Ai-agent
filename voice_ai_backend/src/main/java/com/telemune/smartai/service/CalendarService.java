package com.telemune.smartai.service;

import com.telemune.smartai.db.Db;
import com.telemune.smartai.util.J;
import com.telemune.smartai.web.ApiException;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Calendar events agents add during calls (table calendar_events), exported as standard .ics files. */
@Service
public class CalendarService {
  private static final DateTimeFormatter ICS = DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'").withZone(ZoneOffset.UTC);
  private final Db db;

  public CalendarService(Db db) {
    this.db = db;
  }

  private static Map<String, Object> fromRow(Map<String, Object> r) {
    return J.map("id", r.get("id"), "agentId", r.get("agent_id"), "title", r.get("title"), "start", J.iso(r.get("start_at")),
        "durationMin", r.get("duration_min"), "notes", r.get("notes"), "source", r.get("source"), "createdAt", J.iso(r.get("created_at")),
        "externalProvider", r.get("external_provider"), "attendeeEmail", r.get("attendee_email"));
  }

  public List<Map<String, Object>> list(String userId) {
    return db.query("SELECT * FROM calendar_events WHERE user_id = ? ORDER BY start_at", userId).stream().map(CalendarService::fromRow).toList();
  }

  public Map<String, Object> add(Map<String, Object> in, String userId, Map<String, Object> agent) {
    String title = J.str(in.get("title"), 120);
    Instant start = J.parseInstant(in.get("start"));
    if (title.isEmpty() || start == null) throw ApiException.bad("An event needs a title and a valid start time.");
    String id = J.newId();
    long minutes = J.num(in.get("durationMin"));
    minutes = Math.min(Math.max(minutes == 0 ? 30 : minutes, 5), 24 * 60);
    String source = J.str(in.get("source"), 40);
    db.exec("INSERT INTO calendar_events (id, user_id, agent_id, title, start_at, duration_min, notes, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        id, userId, agent == null ? null : agent.get("id"), title, J.utc(start), minutes, J.str(in.get("notes"), 500), source.isEmpty() ? "agent" : source);
    return fromRow(db.one("SELECT * FROM calendar_events WHERE id = ?", id));
  }

  public Map<String, Object> remove(String id, String userId) {
    Map<String, Object> ev = db.one("SELECT * FROM calendar_events WHERE id = ? AND user_id = ?", J.str(id, 16), userId);
    if (ev == null) return null;
    db.exec("DELETE FROM calendar_events WHERE id = ?", ev.get("id"));
    return fromRow(ev);
  }

  private static String icsText(Object s) {
    return J.str(s).replace("\\", "\\\\").replace("\n", "\\n").replace(",", "\\,").replace(";", "\\;");
  }

  public String toIcs(String userId, String onlyId) {
    List<String> lines = new ArrayList<>(List.of("BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//TelemuneSmartAi//Calendar//EN", "CALSCALE:GREGORIAN"));
    for (Map<String, Object> e : list(userId)) {
      if (onlyId != null && !onlyId.equals(e.get("id"))) continue;
      Instant start = Instant.parse((String) e.get("start"));
      lines.add("BEGIN:VEVENT");
      lines.add("UID:" + e.get("id") + "@telemunesmartai");
      lines.add("DTSTAMP:" + ICS.format(Instant.parse((String) e.get("createdAt"))));
      lines.add("DTSTART:" + ICS.format(start));
      lines.add("DTEND:" + ICS.format(start.plusSeconds(J.num(e.get("durationMin")) * 60)));
      lines.add("SUMMARY:" + icsText(e.get("title")));
      if (!J.blank(e.get("notes"))) lines.add("DESCRIPTION:" + icsText(e.get("notes")));
      lines.add("END:VEVENT");
    }
    lines.add("END:VCALENDAR");
    return String.join("\r\n", lines) + "\r\n";
  }
}
