package com.telemune.smartai.web;

import com.telemune.smartai.service.AgentService;
import com.telemune.smartai.service.AuthService;
import com.telemune.smartai.service.LogService;
import com.telemune.smartai.util.J;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Set;

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
  private static final Set<String> PUBLIC = Set.of("POST /api/login", "POST /api/signup", "POST /api/logout", "GET /api/auth-options", "GET /api/health");

  private final AuthService auth;
  private final AgentService agents;
  private final LogService logs;

  public ApiFilter(AuthService auth, AgentService agents, LogService logs) {
    this.auth = auth;
    this.agents = agents;
    this.logs = logs;
  }

  /** The caller's IP: the frontend app forwards it in X-Forwarded-For (only trusted from this machine). */
  static String clientIp(HttpServletRequest req) {
    String remote = req.getRemoteAddr();
    String fwd = req.getHeader("X-Forwarded-For");
    boolean local = "127.0.0.1".equals(remote) || "0:0:0:0:0:0:0:1".equals(remote) || "::1".equals(remote);
    if (local && fwd != null && !fwd.isBlank()) return fwd.split(",")[0].trim();
    return remote;
  }

  public static String cookie(HttpServletRequest req) {
    if (req.getCookies() == null) return null;
    for (Cookie c : req.getCookies()) if (AuthService.COOKIE.equals(c.getName())) return c.getValue();
    return null;
  }

  private static void json(HttpServletResponse res, int status, String error) throws IOException {
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
    req.setAttribute("ctx", ctx);
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
      ctx.dataUserId = ctx.userId();
      if (path.startsWith("/api/admin/") && !ctx.isAdmin()) {
        json(res, 403, "Admins only.");
        return;
      }
      if (!path.equals("/api/me") && !path.startsWith("/api/me/") && !path.startsWith("/api/admin/")) {
        // Admin may read (GET only) another user's data with ?as=<userId>.
        String as = req.getParameter("as");
        if (as != null && !as.isBlank() && ctx.isAdmin() && "GET".equals(method)) {
          if (auth.getUser(as) == null) {
            json(res, 404, "User not found.");
            return;
          }
          ctx.dataUserId = as;
        }
        String wanted = req.getHeader("X-Agent-Id");
        if (wanted == null || wanted.isBlank()) wanted = req.getParameter("agentId");
        ctx.agent = agents.resolve(ctx.dataUserId, wanted);
      }
      chain.doFilter(req, res);
    } finally {
      logs.request(ctx, method, path, res.getStatus(), (System.nanoTime() - t0) / 1_000_000);
    }
  }
}
