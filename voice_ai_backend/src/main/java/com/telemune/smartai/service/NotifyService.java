package com.telemune.smartai.service;

import com.telemune.smartai.util.J;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.core.env.Environment;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Messages that leave the app: call summaries after a call (WhatsApp, email; Flash SMS later) and emergency alerts
 * (WhatsApp, email). Everything runs in the background so a slow gateway never holds up the call.
 *
 * Email: Spring Mail (spring.mail.* in keys.env). WhatsApp: the Telemune WhatsApp gateway (whatsapp.* in keys.env):
 *   POST {base-url}{template-send-path}  {"to": "+<number>", "template": <name>, "reply": <text>, "params": [<v1>, <v2>, ...]}
 * The query parameter names and the values each template takes are settings (whatsapp.param.*, whatsapp.*-params),
 * so they can match the gateway without code changes. Values: agent, owner, recipient, caller, date, duration, summary,
 * brief (the summary on one line), label, keyword, number.
 */
@Service
public class NotifyService {
  private static final Logger log = LoggerFactory.getLogger(NotifyService.class);
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
  private final ExecutorService pool = Executors.newFixedThreadPool(2, r -> { Thread t = new Thread(r, "notify"); t.setDaemon(true); return t; });
  private final Environment env;
  private final ObjectProvider<JavaMailSender> mail;

  public NotifyService(Environment env, ObjectProvider<JavaMailSender> mail) {
    this.env = env;
    this.mail = mail;
  }

  private String prop(String k, String def) {
    String v = env.getProperty(k);
    return v == null || v.isBlank() ? def : v.trim();
  }

  public boolean whatsappReady() {
    return "true".equalsIgnoreCase(prop("whatsapp.enabled", "false")) && !prop("whatsapp.base-url", "").isEmpty();
  }

  public boolean emailReady() {
    return mail.getIfAvailable() != null && !prop("spring.mail.username", "").isEmpty();
  }

  /** Which channels are set up on the server (the Tools tab greys out the others). */
  public Map<String, Object> channels() {
    return J.map("whatsapp", whatsappReady(), "email", emailReady(), "sms", false);
  }

  // ---------- call summaries ----------
  /** After a call is saved: send its summary on every channel the agent has switched on. */
  public void callSummary(Map<String, Object> agent, Map<String, Object> call) {
    if (agent == null || agent.get("notify") == null) return;
    Map<String, Object> n = J.obj(J.parse(agent.get("notify")));
    String summary = J.str(call.get("summary"));
    if (summary.isBlank() || summary.equals("No summary.")) return;
    Map<String, String> v = values(agent, call);
    Map<String, Object> wa = J.obj(n.get("whatsapp")), em = J.obj(n.get("email"));
    if (J.bool(wa.get("on")) && !J.blank(wa.get("to"))) {
      pool.submit(() -> whatsapp(prop("whatsapp.base-url", ""), J.str(wa.get("to")), prop("whatsapp.summary-template", "ai_message_summary"),
          prop("whatsapp.summary-header", "Conversation Summary"), prop("whatsapp.summary-params", "recipient,brief"), v, "summary"));
    }
    if (J.bool(em.get("on")) && !J.blank(em.get("to"))) {
      String subject = "Call summary · " + v.get("agent") + " · " + v.get("date");
      pool.submit(() -> email(J.str(em.get("to")), subject, CallService.summaryText(call), "summary"));
    }
  }

  private static Map<String, String> values(Map<String, Object> agent, Map<String, Object> call) {
    String date = J.str(call.get("startedAt"));
    try {
      date = java.time.format.DateTimeFormatter.ofPattern("d MMM yyyy, HH:mm").withZone(java.time.ZoneId.systemDefault()).format(java.time.Instant.parse(date));
    } catch (Exception ignored) { }
    String caller = "";
    for (Object m : J.list(J.get(J.obj(call.get("stats")), "messages"))) { caller = J.str(J.obj(m).get("callerName")); if (!caller.isEmpty()) break; }
    Map<String, String> v = new java.util.HashMap<>();
    v.put("agent", J.str(agent.get("name")));
    v.put("owner", J.str(agent.get("owner_name")));
    v.put("caller", caller.isEmpty() ? "Caller" : caller);
    v.put("date", date);
    v.put("duration", J.str(call.get("duration")));
    v.put("summary", J.str(call.get("summary")));
    v.put("recipient", J.str(agent.get("owner_name")).isEmpty() ? J.str(agent.get("name")) : J.str(agent.get("owner_name")));
    v.put("brief", brief(J.str(call.get("summary")), J.str(agent.get("name")), date, J.str(call.get("duration"))));
    return v;
  }

  /**
   * The summary as one WhatsApp template value: no line breaks (WhatsApp refuses them in values), sections joined with
   * " · ", "Summary:" label dropped, at most ~700 characters (the whole template message must stay under 1024).
   */
  static String brief(String summary, String agent, String date, String duration) {
    StringBuilder b = new StringBuilder(agent + " call, " + date + (duration.isEmpty() ? "" : " (" + duration + ")") + ": ");
    for (String line : summary.split("\\r?\\n")) {
      String t = line.trim().replaceFirst("^Summary:\\s*", "").replaceFirst("^-\\s*", "");
      if (t.isEmpty() || t.matches("(?i)^(key details|action items):?$")) continue;
      b.append(t).append(t.matches(".*[.!?:]$") ? " " : ". ");
    }
    String one = b.toString().replaceAll("\\s{2,}", " ").trim();
    return one.length() > 700 ? one.substring(0, 697) + "…" : one;
  }

  // ---------- emergency alerts ----------
  /** A caller said an emergency word: tell the contact (WhatsApp or email; phone contacts are only shown to the caller). */
  public String emergency(Map<String, Object> agent, Map<String, Object> rule, String keyword) {
    String type = J.str(rule.get("type")), to = J.str(rule.get("number"));
    Map<String, String> v = new java.util.HashMap<>();
    v.put("agent", J.str(agent.get("name")));
    v.put("owner", J.str(agent.get("owner_name")));
    v.put("label", J.str(rule.get("label")));
    v.put("keyword", keyword);
    v.put("number", to);
    v.put("date", java.time.format.DateTimeFormatter.ofPattern("d MMM yyyy, HH:mm").withZone(java.time.ZoneId.systemDefault()).format(java.time.Instant.now()));
    if ("whatsapp".equals(type)) {
      if (!whatsappReady()) return "whatsapp not set up";
      String base = prop("whatsapp.emergency-base-url", prop("whatsapp.base-url", ""));
      pool.submit(() -> whatsapp(base, to, prop("whatsapp.emergency-template", "emergency_alert_new"),
          prop("whatsapp.emergency-header", ""), prop("whatsapp.emergency-params", "agent,keyword"), v, "emergency"));
      return "whatsapp";
    }
    if ("email".equals(type)) {
      if (!emailReady()) return "email not set up";
      String body = "Emergency alert from " + v.get("agent") + (v.get("owner").isEmpty() ? "" : " (works for " + v.get("owner") + ")") + ".\n\n"
          + "During a call the caller mentioned \"" + keyword + "\" (" + v.get("label") + ").\nTime: " + v.get("date") + "\n\nPlease follow up straight away.";
      pool.submit(() -> email(to, "⚠ Emergency alert · " + v.get("agent") + " · " + keyword, body, "emergency"));
      return "email";
    }
    return "phone";
  }

  // ---------- channels ----------
  /** One value for a WhatsApp template parameter: one line, no commas (they separate the parameters), WhatsApp's length limit. */
  static String param(String s) {
    String one = (s == null ? "" : s).replaceAll("[\\r\\n\\t]+", " · ").replaceAll(" {4,}", "   ").trim();
    return one.length() > 900 ? one.substring(0, 897) + "…" : one.isEmpty() ? "-" : one;
  }

  /**
   * One template message through the Telemune WhatsApp gateway (format confirmed by the gateway team, 2026-11-19):
   *   POST {base}{template-send-path}  {"to": "91…", "template": "<name>", "headerParam": "<header>", "params": [v1, v2, …], "reply": "Thanks"}
   * "to" is the number with country code, digits only. headerParam is sent only when the template has a header value.
   * The gateway answers {"error": …} when WhatsApp refuses the message.
   */
  private void whatsapp(String base, String to, String template, String header, String paramNames, Map<String, String> v, String what) {
    String number = to.replaceAll("[^\\d]", "");
    List<String> params = new ArrayList<>();
    for (String name : paramNames.split(",")) if (!name.isBlank()) params.add(param(v.getOrDefault(name.trim(), "-")));
    String url = base.replaceAll("/+$", "") + prop("whatsapp.template-send-path", "/sendWhatsApp");
    Map<String, Object> body = J.map("to", number, "template", template);
    if (header != null && !header.isBlank()) body.put("headerParam", header);
    body.put("params", params);
    body.put("reply", prop("emergency".equals(what) ? "whatsapp.emergency-reply" : "whatsapp.summary-reply", "Thanks"));
    try {
      HttpRequest req = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(20)).header("Content-Type", "application/json")
          .POST(HttpRequest.BodyPublishers.ofString(J.json(body))).build();
      HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
      boolean error = res.statusCode() / 100 != 2 || res.body().contains("\"error\"");
      String reply = number.isEmpty() ? res.body() : res.body().replace(number, mask(number)); // no full numbers in the log
      if (!error) log.info("WhatsApp {} sent to {} with template {} (HTTP {}): {}", what, mask(number), template, res.statusCode(), J.str(reply, 200));
      else log.warn("WhatsApp {} to {} failed: HTTP {} {}", what, mask(number), res.statusCode(), J.str(reply, 400));
    } catch (Exception e) {
      log.warn("WhatsApp {} to {} failed: {}", what, mask(number), e.toString());
    }
  }

  private void email(String to, String subject, String body, String what) {
    JavaMailSender sender = mail.getIfAvailable();
    if (sender == null) { log.warn("Email {} not sent: spring.mail.* is not set up", what); return; }
    try {
      SimpleMailMessage m = new SimpleMailMessage();
      m.setFrom(prop("mail.from", prop("spring.mail.username", "")));
      m.setTo(to.split(","));
      m.setSubject(subject);
      m.setText(body + "\n\n—\nSent by TelemuneSmartAi");
      sender.send(m);
      log.info("Email {} sent to {}", what, to);
    } catch (Exception e) {
      log.warn("Email {} to {} failed: {}", what, to, e.getMessage());
    }
  }

  private static String enc(String s) {
    return URLEncoder.encode(s, StandardCharsets.UTF_8);
  }

  /** Phone numbers in logs: last 4 digits only. */
  static String mask(String n) {
    return n.length() <= 4 ? n : "…" + n.substring(n.length() - 4);
  }
}
