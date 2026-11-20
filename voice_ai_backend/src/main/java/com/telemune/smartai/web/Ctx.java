package com.telemune.smartai.web;

import java.util.Map;

/**
 * Who a request is from and what it works on. Set by ApiFilter, read by controllers with @RequestAttribute("ctx").
 * - user: the signed-in user (public shape), token: their session token
 * - dataUserId: whose data is read/written (the admin may read another user's with GET ?as=<id>)
 * - agent: the user's agent this request is for (X-Agent-Id header, else their default agent), with its emergency rules
 */
public class Ctx {
  public final String ip;
  /** Short id of this request: in every log line ([reqId]), the X-Request-Id header, api_logs and activity_logs. */
  public String requestId;
  public Map<String, Object> user;
  public String token;
  public String dataUserId;
  public Map<String, Object> agent;

  public Ctx(String ip) {
    this.ip = ip;
  }

  public String userId() {
    return user == null ? null : (String) user.get("id");
  }

  public String username() {
    return user == null ? "" : (String) user.get("username");
  }

  /** Admin or SuperAdmin (role 1 or 0). */
  public boolean isAdmin() {
    return user != null && user.get("role") != null && ((Number) user.get("role")).intValue() <= 1;
  }

  /** The SuperAdmin (role 0): server configuration, restart, admins and their permissions. */
  public boolean isSuper() {
    return user != null && user.get("role") != null && ((Number) user.get("role")).intValue() == 0;
  }

  public String agentId() {
    return agent == null ? null : (String) agent.get("id");
  }
}
