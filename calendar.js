// Calendar events the agents add during calls (when Calendar is on for that agent). MySQL table: calendar_events.
// Exported as a standard .ics file that Google Calendar, Outlook and Apple Calendar can import.
import crypto from "node:crypto";
import { query, one, exec, iso } from "./db.js";
import { currentDataUserId, currentAgent } from "./context.js";

const fromRow = (r) => ({
  id: r.id, agentId: r.agent_id, title: r.title, start: iso(r.start_at), durationMin: r.duration_min,
  notes: r.notes, source: r.source, createdAt: iso(r.created_at),
});

export async function listEvents(userId = currentDataUserId()) {
  return (await query("SELECT * FROM calendar_events WHERE user_id = ? ORDER BY start_at", [userId])).map(fromRow);
}

export async function addEvent(input, userId = currentDataUserId(), agent = currentAgent()) {
  const title = String(input.title || "").trim().slice(0, 120);
  const start = new Date(input.start);
  if (!title || Number.isNaN(start.getTime())) throw new Error("An event needs a title and a valid start time.");
  const id = crypto.randomUUID().slice(0, 8);
  await exec(
    "INSERT INTO calendar_events (id, user_id, agent_id, title, start_at, duration_min, notes, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [id, userId, agent?.id || null, title, start, Math.min(Math.max(Number(input.durationMin) || 30, 5), 24 * 60),
      String(input.notes || "").slice(0, 500), String(input.source || "agent").slice(0, 40)],
  );
  return fromRow(await one("SELECT * FROM calendar_events WHERE id = ?", [id]));
}

export async function removeEvent(id, userId = currentDataUserId()) {
  const ev = await one("SELECT * FROM calendar_events WHERE id = ? AND user_id = ?", [String(id).slice(0, 16), userId]);
  if (!ev) return null;
  await exec("DELETE FROM calendar_events WHERE id = ?", [ev.id]);
  return fromRow(ev);
}

const icsDate = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = (s) => String(s).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (m) => "\\" + m);

export async function toIcs(id = null) {
  const events = (await listEvents()).filter((e) => !id || e.id === id);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//TelemuneSmartAi//Calendar//EN", "CALSCALE:GREGORIAN"];
  for (const e of events) {
    const end = new Date(new Date(e.start).getTime() + e.durationMin * 60000);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.id}@telemunesmartai`,
      `DTSTAMP:${icsDate(e.createdAt)}`,
      `DTSTART:${icsDate(e.start)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${icsText(e.title)}`,
      ...(e.notes ? [`DESCRIPTION:${icsText(e.notes)}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
