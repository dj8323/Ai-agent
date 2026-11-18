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

  public boolean isAdmin() {
    return user != null && ((Number) user.get("role")).intValue() == 1;
  }

  public String agentId() {
    return agent == null ? null : (String) agent.get("id");
  }
}
