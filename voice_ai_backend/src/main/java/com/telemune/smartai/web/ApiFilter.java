package com.telemune.smartai.web;

import java.util.List;
import com.telemune.smartai.service.AgentService;
import com.telemune.smartai.service.AuthService;
import com.telemune.smartai.service.LogService;
import com.telemune.smartai.util.J;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ThreadLocalRandom;

/**
 * Runs before every /api request:
 * 1. builds the request context (Ctx) and logs the request to api_logs when it finishes;
 * 2. lets the public routes through (login, signup, logout, auth-options);
 * 3. requires a valid session cookie, blocks cross-site writes, keeps /api/admin/* for admins;
 * 4. picks whose data (admin GET ?as=<userId>) and which agent (X-Agent-Id header, else the default agent).
 */
@Component
@Order(1)
public class ApiFilter extends OncePerRequestFilter {
  private static final Logger log = LoggerFactory.getLogger(ApiFilter.class);
  /** Requests slower than this are logged as WARN (chat streams and speech are long by nature, so they're left out). */
  private static final long SLOW_MS = 3000;
  private static final Set<String> PUBLIC = Set.of("POST /api/login", "POST /api/signup", "POST /api/logout", "GET /api/auth-options", "GET /api/health");

  private final AuthService auth;
  private final AgentService agents;
  private final LogService logs;

  /** Extra addresses of voice_ai_web servers whose X-Forwarded-For is trusted (TRUSTED_PROXIES in .env, comma list). */
  private static volatile java.util.Set<String> trustedProxies = java.util.Set.of();

  public ApiFilter(AuthService auth, AgentService agents, LogService logs,
                   @org.springframework.beans.factory.annotation.Value("${TRUSTED_PROXIES:}") String trusted) {
    trustedProxies = java.util.Arrays.stream(trusted.split(",")).map(String::trim).filter(x -> !x.isEmpty())
        .collect(java.util.stream.Collectors.toUnmodifiableSet());
    this.auth = auth;
    this.agents = agents;
    this.logs = logs;
  }

  /** The caller's IP: voice_ai_web forwards it in X-Forwarded-For (trusted from this machine and TRUSTED_PROXIES). */
  static String clientIp(HttpServletRequest req) {
    String remote = req.getRemoteAddr();
    String fwd = req.getHeader("X-Forwarded-For");
    boolean local = "127.0.0.1".equals(remote) || "0:0:0:0:0:0:0:1".equals(remote) || "::1".equals(remote)
        || trustedProxies.contains(remote);
    if (local && fwd != null && !fwd.isBlank()) return fwd.split(",")[0].trim();
    return remote;
  }

  public static String cookie(HttpServletRequest req) {
    if (req.getCookies() == null) return null;
    for (Cookie c : req.getCookies()) if (AuthService.COOKIE.equals(c.getName())) return c.getValue();
    return null;
  }

  private static void json(HttpServletResponse res, int status, String error) throws IOException {
    log.info("Refused {}: {}", status, error);
    res.setStatus(status);
    res.setContentType("application/json");
    res.setCharacterEncoding("UTF-8");
    res.getOutputStream().write(J.json(Map.of("error", error)).getBytes(StandardCharsets.UTF_8));
  }

  @Override
  protected boolean shouldNotFilter(HttpServletRequest req) {
    return !req.getRequestURI().startsWith("/api/");
  }

  @Override
  protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
    long t0 = System.nanoTime();
    String path = req.getRequestURI();
    String method = req.getMethod();
    Ctx ctx = new Ctx(clientIp(req));
    ctx.requestId = String.format("%08x", ThreadLocalRandom.current().nextInt());
    req.setAttribute("ctx", ctx);
    res.setHeader("X-Request-Id", ctx.requestId);
    MDC.put("reqId", ctx.requestId);
    if (log.isDebugEnabled()) {
      String q = req.getQueryString();
      log.debug("→ {} {}{} from {} ({})", method, path, q == null ? "" : "?" + q.replaceAll("(?i)(password|token)=[^&]*", "$1=***"), ctx.ip,
          J.str(req.getHeader("User-Agent"), 80));
    }
    try {
      if (PUBLIC.contains(method + " " + path)) {
        chain.doFilter(req, res);
        return;
      }
      String token = cookie(req);
      Map<String, Object> user = auth.userForToken(token);
      if (user == null) {
        json(res, 401, "Please sign in.");
        return;
      }
      // Block cross-site requests that change data.
      String origin = req.getHeader("Origin");
      if (!"GET".equals(method) && origin != null && !origin.isBlank() && !"null".equals(origin)) {
        String host = req.getHeader("Host");
        String originHost;
        try {
          originHost = URI.create(origin).getAuthority();
        } catch (Exception e) {
          originHost = "";
        }
        if (host == null || !host.equalsIgnoreCase(originHost)) {
          json(res, 403, "Cross-site request blocked.");
          return;
        }
      }
      ctx.user = user;
      ctx.token = token;
      MDC.put("user", ctx.username());
      ctx.dataUserId = ctx.userId();
      if (path.startsWith("/api/admin/") && !ctx.isAdmin()) {
        json(res, 403, "Admins only.");
        return;
      }
      if (path.startsWith("/api/super/") && !ctx.isSuper()) {
        json(res, 404, "Not found."); // the SuperAdmin area doesn't exist for anyone else
        return;
      }
      if (path.startsWith("/api/admin/") && !ctx.isSuper() && !adminSectionAllowed(path, method, user)) {
        json(res, 403, "This section isn't open for your account.");
        return;
      }
      if (!path.equals("/api/me") && !path.startsWith("/api/me/") && !path.startsWith("/api/admin/")) {
        // Admin may read (GET only) another user's data with ?as=<userId>.
        String as = req.getParameter("as");
        if (as != null && !as.isBlank() && ctx.isAdmin() && "GET".equals(method)) {
          Map<String, Object> target = auth.getUser(as);
          if (target == null || (!ctx.isSuper() && J.num(target.get("role_id")) == 0)) {
            json(res, 404, "User not found.");
            return;
          }
          ctx.dataUserId = as;
        }
        String wanted = req.getHeader("X-Agent-Id");
        if (wanted == null || wanted.isBlank()) wanted = req.getParameter("agentId");
        ctx.agent = agents.resolve(ctx.dataUserId, wanted);
        if (ctx.agent != null) MDC.put("agent", ctx.agentId());
        if (!ctx.dataUserId.equals(ctx.userId())) log.info("Admin reading the data of user {}", ctx.dataUserId);
      }
      chain.doFilter(req, res);
    } finally {
      long ms = (System.nanoTime() - t0) / 1_000_000;
      int status = res.getStatus();
      boolean streaming = path.equals("/api/chat") || path.startsWith("/api/tts") || path.equals("/api/transcribe");
      if (status >= 500) log.error("← {} {} {} in {} ms", method, path, status, ms);
      // "Who is signed in?" answering 401 is normal (signed-out visitors), so it stays out of error.log
      else if (status == 401 && "/api/me".equals(path)) log.info("← {} {} {} in {} ms", method, path, status, ms);
      else if (status >= 400) log.warn("← {} {} {} in {} ms", method, path, status, ms);
      else if (ms > SLOW_MS && !streaming) log.warn("← {} {} {} in {} ms (slow)", method, path, status, ms);
      else log.info("← {} {} {} in {} ms", method, path, status, ms);
      logs.request(ctx, method, path, status, ms);
      MDC.clear();
    }
  }

  /** Which dashboard section an /api/admin/ path belongs to; an admin needs that section (the SuperAdmin decides). */
  private static boolean adminSectionAllowed(String path, String method, Map<String, Object> user) {
    List<?> mine = (List<?>) AuthService.effective(user).get("admin");
    String p = path.substring("/api/admin/".length());
    // the overview data, and opening one user (👁 View), serve Overview, Users, Agents and Calls & usage
    if (p.startsWith("overview") || ("GET".equals(method) && p.matches("users/[A-Za-z0-9]+"))) return mine.stream().anyMatch(x -> List.of("overview", "users", "agents", "usage").contains(String.valueOf(x)));
    String section = p.startsWith("users") ? "users" : p.startsWith("logs") ? "activity" : p.startsWith("logins") ? "logins"
        : p.startsWith("config") || p.startsWith("log-level") ? "settings" : p.startsWith("templates") || p.startsWith("types") ? "templates" : "overview";
    return mine.contains(section);
  }
}
