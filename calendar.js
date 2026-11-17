// Local calendar: events the agent adds during calls (when calendar is switched on), in data/calendar.json.
// Exported as a standard .ics file that Google Calendar, Outlook and Apple Calendar can import.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { userDataDir } from "./context.js";

// Each user's calendar lives in data/users/<userId>/calendar.json (user taken from the request context).
const FILE_FOR = () => path.join(userDataDir(), "calendar.json");

async function readAll() {
  try {
    return JSON.parse(await fs.readFile(FILE_FOR(), "utf8"));
  } catch {
    return [];
  }
}

async function writeAll(list) {
  const file = FILE_FOR();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(list, null, 2));
}

export async function listEvents() {
  return (await readAll()).sort((a, b) => a.start.localeCompare(b.start));
}

export async function addEvent(input) {
  const title = String(input.title || "").trim().slice(0, 120);
  const start = new Date(input.start);
  if (!title || Number.isNaN(start.getTime())) throw new Error("An event needs a title and a valid start time.");
  const ev = {
    id: crypto.randomUUID().slice(0, 8),
    title,
    start: start.toISOString(),
    durationMin: Math.min(Math.max(Number(input.durationMin) || 30, 5), 24 * 60),
    notes: String(input.notes || "").slice(0, 500),
    source: String(input.source || "agent").slice(0, 40),
    createdAt: new Date().toISOString(),
  };
  const all = await readAll();
  all.push(ev);
  await writeAll(all);
  return ev;
}

export async function removeEvent(id) {
  const all = await readAll();
  const next = all.filter((e) => e.id !== id);
  await writeAll(next);
  return next.length !== all.length;
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
