package com.telemune.smartai.api;

import com.telemune.smartai.service.AppConfigService;
import com.telemune.smartai.service.CalendarService;
import com.telemune.smartai.service.CallService;
import com.telemune.smartai.service.LogService;
import com.telemune.smartai.service.MessageService;
import com.telemune.smartai.service.PlaybookService;
import com.telemune.smartai.service.TemplateService;
import com.telemune.smartai.util.J;
import com.telemune.smartai.web.ApiException;
import com.telemune.smartai.web.Ctx;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.Map;

/** A user's own data: playbooks, calls (+ summaries, recordings), calendar events, caller messages. */
@RestController
public class DataController {
  private final AppConfigService config;
  private final TemplateService templates;
  private final PlaybookService playbooks;
  private final CallService calls;
  private final CalendarService calendar;
  private final MessageService messages;
  private final LogService logs;
  private final com.telemune.smartai.service.NotifyService notify;
  private final com.telemune.smartai.service.CalendarSyncService calSync;

  public DataController(AppConfigService config, TemplateService templates, PlaybookService playbooks, CallService calls,
                        CalendarService calendar, MessageService messages, LogService logs, com.telemune.smartai.service.NotifyService notify,
                        com.telemune.smartai.service.CalendarSyncService calSync) {
    this.notify = notify;
    this.calSync = calSync;
    this.config = config;
    this.templates = templates;
    this.playbooks = playbooks;
    this.calls = calls;
    this.calendar = calendar;
    this.messages = messages;
    this.logs = logs;
  }

  // ---------- playbooks ----------
  @GetMapping("/api/playbooks")
  Map<String, Object> playbooks(@RequestAttribute("ctx") Ctx ctx) {
    return J.map("types", com.telemune.smartai.service.AuthService.filterTypes(templates.catalog(false), ctx.user, "playbookTypes", null), "saved", playbooks.list(ctx.dataUserId));
  }

  @PostMapping("/api/playbooks")
  ResponseEntity<Map<String, Object>> addPlaybook(@RequestBody Map<String, Object> body, @RequestAttribute("ctx") Ctx ctx) {
    java.util.List<String> okTypes = com.telemune.smartai.service.AuthService.types(ctx.user, "playbookTypes");
    if (okTypes != null && !okTypes.contains(J.str(body.get("type")))) throw com.telemune.smartai.web.ApiException.forbidden("That playbook type isn't open for your account.");
    Map<String, Object> pb = playbooks.add(body, ctx.dataUserId);
    logs.activity(ctx, "playbook.add", (String) pb.get("name"), J.map("id", pb.get("id"), "type", pb.get("type")));
    return ResponseEntity.status(201).body(pb);
  }

  @DeleteMapping("/api/playbooks/{id}")
  ResponseEntity<Map<String, Object>> deletePlaybook(@PathVariable String id, @RequestAttribute("ctx") Ctx ctx) {
    Map<String, Object> pb = playbooks.remove(id, ctx.dataUserId);
    if (pb != null) logs.activity(ctx, "playbook.delete", (String) pb.get("name"), J.map("id", id));
    return ResponseEntity.status(pb != null ? 200 : 404).body(J.map("ok", pb != null));
  }

  // ---------- calls ----------
  @GetMapping("/api/calls")
  Map<String, Object> calls(@RequestParam(defaultValue = "1") int page, @RequestParam(required = false) Integer pageSize,
                            @RequestParam(required = false) String agent, @RequestParam(required = false) String channel,
                            @RequestAttribute("ctx") Ctx ctx) {
    int size = pageSize != null && pageSize > 0 ? pageSize : (int) Math.max(1, J.num(J.get(config.forAgent(ctx.agent), "history.pageSize")));
    return calls.list(page, Math.min(size, 100), J.blank(agent) ? null : agent, J.blank(channel) ? null : channel, ctx.dataUserId);
  }

  @GetMapping("/api/calls/stats")
  Map<String, Object> callStats(@RequestAttribute("ctx") Ctx ctx) {
    return calls.stats(ctx.dataUserId);
  }

  @PostMapping("/api/calls")
  ResponseEntity<Map<String, Object>> saveCall(@RequestBody Map<String, Object> body, @RequestAttribute("ctx") Ctx ctx) {
    Map<String, Object> call = calls.save(body, ctx.dataUserId, ctx.agent);
    logs.activity(ctx, "call.save", (String) call.get("agentName"), J.map("id", call.get("id"), "duration", call.get("duration"),
        "tokens", J.num(J.get(J.obj(call.get("stats")), "tokens.total"))));
    if (ctx.agent != null && ctx.dataUserId.equals(ctx.agent.get("user_id"))) notify.callSummary(ctx.agent, call); // WhatsApp / email, in the background
    return ResponseEntity.status(201).body(call);
  }

  /** 🟢 WhatsApp on the call page: send a typed message to a number. Body {to, message}. */
  @PostMapping("/api/whatsapp/send")
  ResponseEntity<Map<String, Object>> whatsappSend(@RequestBody Map<String, Object> body, @RequestAttribute("ctx") Ctx ctx) {
    if (!com.telemune.smartai.service.AuthService.can(ctx.user, "talk.whatsapp")) throw com.telemune.smartai.web.ApiException.forbidden("WhatsApp is switched off for your account.");
    Map<String, Object> r = notify.sendText(J.str(body.get("to"), 30), J.str(body.get("message"), 4000), ctx.agent);
    String number = J.str(body.get("to"), 30).replaceAll("[^\\d]", "");
    if (!number.isEmpty() && !J.blank(body.get("message")))
      r.put("recordId", calls.saveWhatsApp(ctx.dataUserId, ctx.agent, number, J.str(body.get("message"), 4000), r).get("id")); // shown in Call summaries
    logs.activity(ctx, "whatsapp.send", ctx.agent == null ? "" : J.str(ctx.agent.get("name")),
        J.map("to", J.str(r.get("to")), "ok", r.get("ok"), "chars", J.str(body.get("message")).length()));
    return ResponseEntity.ok(r); // {ok:false, error} when WhatsApp refused it: a normal answer, shown on the page
  }

  /** The caller said an emergency word: alert that contact by WhatsApp or email (phone contacts are only shown). Body {label, keyword}. */
  @PostMapping("/api/emergency/alert")
  ResponseEntity<Map<String, Object>> emergencyAlert(@RequestBody Map<String, Object> body, @RequestAttribute("ctx") Ctx ctx) {
    if (ctx.agent == null) return ResponseEntity.badRequest().body(J.map("error", "No agent"));
    String label = J.str(body.get("label"), 40), keyword = J.str(body.get("keyword"), 40);
    Map<String, Object> rule = null;
    for (Object o : J.list(ctx.agent.get("rules"))) if (label.equals(J.str(J.obj(o).get("label")))) { rule = J.obj(o); break; }
    if (rule == null) return ResponseEntity.status(404).body(J.map("error", "No such emergency contact"));
    String sent = notify.emergency(ctx.agent, rule, keyword);
    logs.activity(ctx, "emergency.alert", label, J.map("keyword", keyword, "channel", sent));
    return ResponseEntity.ok(J.map("ok", true, "channel", sent));
  }

  @GetMapping("/api/calls/{id}")
  ResponseEntity<Map<String, Object>> call(@PathVariable String id, @RequestAttribute("ctx") Ctx ctx) {
    Map<String, Object> c = calls.get(id, ctx.dataUserId);
    return c == null ? ResponseEntity.status(404).body(J.map("error", "Not found")) : ResponseEntity.ok(c);
  }

  @DeleteMapping("/api/calls/{id}")
  ResponseEntity<Map<String, Object>> deleteCall(@PathVariable String id, @RequestAttribute("ctx") Ctx ctx) throws IOException {
    Map<String, Object> c = calls.delete(id, ctx.dataUserId);
    if (c != null) logs.activity(ctx, "call.delete", (String) c.get("agentName"), J.map("id", id, "startedAt", c.get("startedAt")));
    return ResponseEntity.status(c != null ? 200 : 404).body(J.map("ok", c != null));
  }

  @GetMapping("/api/calls/{id}/summary")
  ResponseEntity<String> summaryFile(@PathVariable String id, @RequestAttribute("ctx") Ctx ctx) {
    String text = calls.summaryFile(id, ctx.dataUserId);
    if (text == null) return ResponseEntity.status(404).contentType(MediaType.TEXT_PLAIN).body("No summary");
    return ResponseEntity.ok().contentType(MediaType.parseMediaType("text/plain; charset=utf-8"))
        .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"call-summary-" + id.replaceAll("[^\\w-]", "") + ".txt\"").body(text);
  }

  @PutMapping("/api/calls/{id}/recording")
  ResponseEntity<Map<String, Object>> putRecording(@PathVariable String id, @RequestAttribute("ctx") Ctx ctx, HttpServletRequest req) throws IOException {
    long limit = Math.max(1, J.num(J.get(config.forAgent(ctx.agent), "history.maxRecordingMB"))) * 1024 * 1024;
    ByteArrayOutputStream buf = new ByteArrayOutputStream();
    try (InputStream in = req.getInputStream()) {
      byte[] chunk = new byte[64 * 1024];
      int n;
      while ((n = in.read(chunk)) > 0) {
        if (buf.size() + n > limit) throw ApiException.bad("Recording too large");
        buf.write(chunk, 0, n);
      }
    }
    Map<String, Object> rec = calls.saveRecording(id, req.getContentType(), buf.toByteArray(), ctx.dataUserId);
    org.slf4j.LoggerFactory.getLogger(DataController.class).info("Recording for call {}: {} KB ({}){}", id, buf.size() / 1024, req.getContentType(),
        rec == null ? " - call not found, not saved" : " saved");
    return rec == null ? ResponseEntity.status(404).body(J.map("error", "Not found")) : ResponseEntity.ok(rec);
  }

  @GetMapping("/api/calls/{id}/recording")
  ResponseEntity<byte[]> getRecording(@PathVariable String id, @RequestAttribute("ctx") Ctx ctx) throws IOException {
    CallService.Recording r = calls.readRecording(id, ctx.dataUserId);
    if (r == null) return ResponseEntity.status(404).contentType(MediaType.TEXT_PLAIN).body("No recording".getBytes());
    String ext = r.file().contains(".") ? r.file().substring(r.file().lastIndexOf('.') + 1) : "webm";
    return ResponseEntity.ok().contentType(MediaType.parseMediaType(r.type()))
        .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"call-" + id.replaceAll("[^\\w-]", "") + "." + ext + "\"").body(r.data());
  }

  // ---------- calendar ----------
  @GetMapping("/api/calendar")
  List<Map<String, Object>> events(@RequestAttribute("ctx") Ctx ctx) {
    return calendar.list(ctx.dataUserId);
  }

  /** /api/calendar/calendar.ics (all events) or /api/calendar/<id>.ics (one). */
  @GetMapping("/api/calendar/{file}")
  ResponseEntity<String> ics(@PathVariable String file, @RequestAttribute("ctx") Ctx ctx) {
    if (!file.endsWith(".ics")) throw ApiException.notFound("Not found");
    String id = file.equals("calendar.ics") ? null : file.substring(0, file.length() - 4);
    String name = id == null ? "telemunesmartai-calendar.ics" : "event-" + id.replaceAll("[^\\w-]", "") + ".ics";
    return ResponseEntity.ok().contentType(MediaType.parseMediaType("text/calendar; charset=utf-8"))
        .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + name + "\"").body(calendar.toIcs(ctx.dataUserId, id));
  }

  @PostMapping("/api/calendar")
  ResponseEntity<Map<String, Object>> addEvent(@RequestBody Map<String, Object> body, @RequestAttribute("ctx") Ctx ctx) {
    if (!J.bool(J.get(config.forAgent(ctx.agent), "calendar.enabled"))) throw ApiException.forbidden("Calendar is switched off in Agent setup.");
    if (body.containsKey("when")) {
      // booked by the agent: {title, when: "2026-11-21T15:00" (agent's zone) | "NOW", durationMin, notes}. Checked again first:
      // 201 = booked (also in the linked calendar), 409 = taken or outside hours, with free options.
      Map<String, Object> r = calSync.book(ctx.agent, ctx.dataUserId, J.str(body.get("title"), 120), J.str(body.get("when")), J.num(body.get("durationMin")),
          J.str(body.get("notes"), 500), J.str(body.get("source"), 40));
      if (!J.bool(r.get("booked"))) return ResponseEntity.status(409).body(r);
      logs.activity(ctx, "calendar.add", (String) r.get("title"), J.map("id", r.get("id"), "start", r.get("start"), "agentId", ctx.agentId(), "calendar", r.get("calendar")));
      return ResponseEntity.status(201).body(r);
    }
    Map<String, Object> ev = calendar.add(body, ctx.dataUserId, ctx.agent);
    logs.activity(ctx, "calendar.add", (String) ev.get("title"), J.map("id", ev.get("id"), "start", ev.get("start"), "agentId", ev.get("agentId")));
    return ResponseEntity.status(201).body(ev);
  }

  @DeleteMapping("/api/calendar/{id}")
  ResponseEntity<Map<String, Object>> deleteEvent(@PathVariable String id, @RequestAttribute("ctx") Ctx ctx) {
    Map<String, Object> ev = calendar.remove(id, ctx.dataUserId);
    if (ev != null) logs.activity(ctx, "calendar.delete", (String) ev.get("title"), J.map("id", id));
    return ResponseEntity.status(ev != null ? 200 : 404).body(J.map("ok", ev != null));
  }

  // ---------- messages callers left ----------
  /** ?scope=all → every agent's; otherwise the current agent's. ?status=new|done filters. */
  @GetMapping("/api/messages")
  Map<String, Object> messages(@RequestParam(required = false) String scope, @RequestParam(required = false) String status,
                               @RequestParam(defaultValue = "50") int limit, @RequestAttribute("ctx") Ctx ctx) {
    String st = "new".equals(status) || "done".equals(status) ? status : null;
    return messages.list(ctx.dataUserId, "all".equals(scope) ? null : ctx.agentId(), st, Math.min(Math.max(limit, 1), 200));
  }

  @PostMapping("/api/messages")
  ResponseEntity<Map<String, Object>> addMessage(@RequestBody Map<String, Object> body, @RequestAttribute("ctx") Ctx ctx) {
    Map<String, Object> m = messages.add(body, ctx.dataUserId, ctx.agent);
    logs.activity(ctx, "message.add", J.str(m.get("callerName"), 60), J.map("id", m.get("id"), "urgency", m.get("urgency"), "agentId", m.get("agentId")));
    return ResponseEntity.status(201).body(m);
  }

  @PatchMapping("/api/messages/{id}")
  Map<String, Object> updateMessage(@PathVariable String id, @RequestBody Map<String, Object> body, @RequestAttribute("ctx") Ctx ctx) {
    Map<String, Object> m = messages.setStatus(id, body.get("status"), ctx.dataUserId);
    logs.activity(ctx, "message." + m.get("status"), J.str(m.get("callerName"), 60), J.map("id", id));
    return m;
  }

  @DeleteMapping("/api/messages/{id}")
  ResponseEntity<Map<String, Object>> deleteMessage(@PathVariable String id, @RequestAttribute("ctx") Ctx ctx) {
    Map<String, Object> m = messages.delete(id, ctx.dataUserId);
    if (m != null) logs.activity(ctx, "message.delete", J.str(m.get("callerName"), 60), J.map("id", id));
    return ResponseEntity.status(m != null ? 200 : 404).body(J.map("ok", m != null));
  }
}
