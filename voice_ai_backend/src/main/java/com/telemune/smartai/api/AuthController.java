package com.telemune.smartai.api;

import com.telemune.smartai.service.AgentService;
import com.telemune.smartai.service.AppConfigService;
import com.telemune.smartai.service.AuthService;
import com.telemune.smartai.service.LogService;
import com.telemune.smartai.util.J;
import com.telemune.smartai.web.ApiException;
import com.telemune.smartai.web.Ctx;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** Sign in, self sign-up, sign out, who am I, change my password. */
@RestController
public class AuthController {
  private final AuthService auth;
  private final AgentService agents;
  private final AppConfigService config;
  private final LogService logs;

  public AuthController(AuthService auth, AgentService agents, AppConfigService config, LogService logs) {
    this.auth = auth;
    this.agents = agents;
    this.config = config;
    this.logs = logs;
  }

  @GetMapping("/api/health")
  Map<String, Object> health() {
    return J.map("ok", true);
  }

  @GetMapping("/api/auth-options")
  Map<String, Object> options() {
    Map<String, Object> cfg = config.app();
    return J.map("allowSignup", J.bool(J.get(cfg, "auth.allowSignup")), "appName", J.get(cfg, "branding.appName"), "tagline", J.get(cfg, "branding.tagline"),
        "theme", J.map("name", J.get(cfg, "branding.theme.name"), "motion", J.get(cfg, "branding.theme.motion"))); // site theme (themes.js)
  }

  @PostMapping("/api/login")
  ResponseEntity<Map<String, Object>> login(@RequestBody(required = false) Map<String, Object> body, @RequestAttribute("ctx") Ctx ctx, HttpServletRequest req) {
    Map<String, Object> b = body == null ? Map.of() : body;
    String username = J.str(b.get("username"), 64).toLowerCase();
    try {
      AuthService.Session s = auth.login(b.get("username"), b.get("password"), J.bool(b.get("remember")), ctx.ip, req.getHeader("User-Agent"));
      logs.activity(ctx, "auth.login", username, J.map("remember", J.bool(b.get("remember"))), (String) s.user().get("id"), username);
      return ResponseEntity.ok().header(HttpHeaders.SET_COOKIE, AuthService.sessionCookie(s.token(), s.maxAge()))
          .body(J.map("ok", true, "user", s.user(), "next", AuthService.isStaff(s.user().get("role")) ? "/admin.html" : "/"));
    } catch (ApiException e) {
      logs.activity(ctx, "auth.login_failed", username, J.map("reason", e.getMessage()), null, username);
      throw e;
    }
  }

  /** Self sign-up (role 2). Max 5 new accounts per IP per hour. Can be switched off: app_config.auth.allowSignup. */
  @PostMapping("/api/signup")
  ResponseEntity<Map<String, Object>> signup(@RequestBody(required = false) Map<String, Object> body, @RequestAttribute("ctx") Ctx ctx, HttpServletRequest req) {
    if (!J.bool(J.get(config.app(), "auth.allowSignup"))) throw ApiException.forbidden("Sign-up is closed. Ask your admin for an account.");
    if (auth.recentSignups(ctx.ip) >= 5) throw new ApiException(429, "Too many new accounts from here. Try again later.");
    Map<String, Object> b = body == null ? Map.of() : body;
    if (!J.str(b.get("password")).equals(J.str(b.get("confirm")))) throw ApiException.bad("The passwords don't match.");
    Map<String, Object> user = auth.createUser(J.map("username", b.get("username"), "name", b.get("name"), "email", b.get("email"), "password", b.get("password")), "self");
    AuthService.Session s = auth.startSession(user, J.bool(b.get("remember")), ctx.ip, req.getHeader("User-Agent"));
    logs.activity(ctx, "auth.signup", (String) user.get("username"), J.map("name", user.get("name"), "email", J.blank(user.get("email")) ? null : user.get("email")),
        (String) user.get("id"), (String) user.get("username"));
    return ResponseEntity.status(201).header(HttpHeaders.SET_COOKIE, AuthService.sessionCookie(s.token(), s.maxAge()))
        .body(J.map("ok", true, "user", s.user(), "next", "/"));
  }

  @PostMapping("/api/logout")
  ResponseEntity<Map<String, Object>> logout(@RequestAttribute("ctx") Ctx ctx, HttpServletRequest req) {
    String token = com.telemune.smartai.web.ApiFilter.cookie(req);
    Map<String, Object> user = auth.userForToken(token);
    if (user != null) {
      auth.logout(token);
      logs.activity(ctx, "auth.logout", (String) user.get("username"), null, (String) user.get("id"), (String) user.get("username"));
    }
    return ResponseEntity.ok().header(HttpHeaders.SET_COOKIE, AuthService.clearCookie()).body(J.map("ok", true));
  }

  @GetMapping("/api/me")
  Map<String, Object> me(@RequestAttribute("ctx") Ctx ctx) {
    Map<String, Object> me = ctx.isSuper() ? ctx.user : AuthService.visibleTo(ctx.user, false, auth.superIds()); // no SuperAdmin traces
    return J.map("user", me, "access", AuthService.effective(ctx.user)); // what this account may see
  }

  @PostMapping("/api/me/password")
  Map<String, Object> password(@RequestBody Map<String, Object> body, @RequestAttribute("ctx") Ctx ctx) {
    auth.changeOwnPassword(ctx.userId(), body.get("current"), body.get("next"));
    logs.activity(ctx, "auth.password_change", ctx.username(), null);
    return J.map("ok", true);
  }
}
