package com.telemune.smartai.api;

import com.telemune.smartai.service.AuthService;
import com.telemune.smartai.service.CalendarSyncService;
import com.telemune.smartai.service.LogService;
import com.telemune.smartai.util.J;
import com.telemune.smartai.web.ApiException;
import com.telemune.smartai.web.Ctx;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * Connecting the agent's real calendar (Google, Microsoft, CalDAV) and the free/busy check the agent runs before booking.
 * The agent is the active one (X-Agent-Id). Secrets never come back to the page.
 */
@RestController
public class CalendarAccountController {
  private final CalendarSyncService sync;
  private final LogService logs;

  public CalendarAccountController(CalendarSyncService sync, LogService logs) {
    this.sync = sync;
    this.logs = logs;
  }

  private static Map<String, Object> agentOf(Ctx ctx) {
    if (ctx.agent == null) throw ApiException.bad("Create an agent first.");
    if (!AuthService.can(ctx.user, "tool.calendar")) throw ApiException.forbidden("The calendar is switched off for your account.");
    return ctx.agent;
  }

  private static void ownOnly(Ctx ctx) {
    if (!ctx.dataUserId.equals(ctx.userId())) throw ApiException.forbidden("Only the owner can change their calendar.");
  }

  @GetMapping("/api/calendar-accounts")
  Map<String, Object> current(@RequestAttribute("ctx") Ctx ctx) {
    return sync.describe(agentOf(ctx));
  }

  /** Body {origin}: the page's address, used for the return link when calendar.oauth.redirect-base isn't set. → {url} */
  @PostMapping("/api/calendar-accounts/oauth/{provider}")
  Map<String, Object> startOAuth(@PathVariable String provider, @RequestBody Map<String, Object> body, @RequestAttribute("ctx") Ctx ctx) {
    ownOnly(ctx);
    return J.map("url", sync.startOAuth(provider, ctx.userId(), agentOf(ctx), J.str(body.get("origin"))));
  }

  /** Google/Microsoft send the person back here; we answer with a redirect to the agent's calendar settings. */
  @GetMapping("/api/calendar-oauth/{provider}/callback")
  ResponseEntity<Void> callback(@PathVariable String provider, @RequestParam(required = false) String code, @RequestParam(required = false) String state,
                                @RequestParam(required = false) String error, @RequestAttribute("ctx") Ctx ctx) {
    String to;
    try {
      if (error != null) throw ApiException.bad("access_denied".equals(error) ? "You cancelled the sign-in." : "The sign-in failed (" + J.str(error, 60) + ").");
      Map<String, Object> r = sync.finishOAuth(provider, code, state, ctx.userId());
      logs.activity(ctx, "calendar.connect", provider, J.map("agentId", r.get("agentId")));
      to = "/?cal=connected&provider=" + enc(provider) + "&agent=" + enc(J.str(r.get("agentId")));
    } catch (ApiException e) {
      to = "/?cal=error&msg=" + enc(e.getMessage());
    }
    return ResponseEntity.status(302).header("Location", to + "#agents/calendar").header("Cache-Control", "no-store").build();
  }

  /** Body {label: yahoo|icloud|zoho|other, url?, username, password (an app password)}. */
  @PostMapping("/api/calendar-accounts/caldav")
  Map<String, Object> caldav(@RequestBody Map<String, Object> body, @RequestAttribute("ctx") Ctx ctx) {
    ownOnly(ctx);
    Map<String, Object> agent = agentOf(ctx);
    Map<String, Object> r = sync.connectCaldav(ctx.userId(), agent, J.str(body.get("label")), J.str(body.get("url")), J.str(body.get("username")), J.str(body.get("password")));
    logs.activity(ctx, "calendar.connect", "caldav/" + r.get("label"), J.map("agentId", agent.get("id")));
    return sync.describe(agent);
  }

  @DeleteMapping("/api/calendar-accounts")
  Map<String, Object> disconnect(@RequestAttribute("ctx") Ctx ctx) {
    ownOnly(ctx);
    Map<String, Object> agent = agentOf(ctx);
    if (sync.disconnect(agent)) logs.activity(ctx, "calendar.disconnect", J.str(agent.get("name")), J.map("agentId", agent.get("id")));
    return sync.describe(agent);
  }

  /** Body {when: "2026-11-21T15:00" (agent's time zone) | "NOW", minutes}. Free, or busy with up to 3 free options. */
  @PostMapping("/api/calendar/check")
  Map<String, Object> check(@RequestBody Map<String, Object> body, @RequestAttribute("ctx") Ctx ctx) {
    return sync.check(agentOf(ctx), ctx.dataUserId, J.str(body.get("when")), J.num(body.get("minutes")));
  }

  private static String enc(String s) {
    return URLEncoder.encode(s, StandardCharsets.UTF_8);
  }
}
