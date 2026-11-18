package com.telemune.smartai.api;

import com.telemune.smartai.service.AgentService;
import com.telemune.smartai.service.LogService;
import com.telemune.smartai.service.TemplateService;
import com.telemune.smartai.util.J;
import com.telemune.smartai.web.Ctx;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** The signed-in user's own agents, and the agent types + templates they can pick from (all from the DB). */
@RestController
public class AgentController {
  private final AgentService agents;
  private final TemplateService templates;
  private final LogService logs;

  public AgentController(AgentService agents, TemplateService templates, LogService logs) {
    this.agents = agents;
    this.templates = templates;
    this.logs = logs;
  }

  @GetMapping("/api/agents")
  Map<String, Object> list(@RequestAttribute("ctx") Ctx ctx) {
    return J.map("agents", agents.list(ctx.dataUserId).stream().map(agents::card).toList(), "currentId", ctx.agentId(),
        "types", templates.catalog(false));
  }

  @GetMapping("/api/templates")
  Map<String, Object> templates() {
    return J.map("types", templates.catalog(false));
  }

  @PostMapping("/api/agents")
  ResponseEntity<Map<String, Object>> create(@RequestBody Map<String, Object> body, @RequestAttribute("ctx") Ctx ctx) {
    Map<String, Object> a = agents.create(body, ctx.dataUserId);
    logs.activity(ctx, "agent.create", (String) a.get("name"), J.map("id", a.get("id"), "type", a.get("agent_type"), "template", a.get("template_id"),
        "for", J.blank(a.get("owner_name")) ? null : a.get("owner_name")));
    return ResponseEntity.status(201).body(agents.card(a));
  }

  @PatchMapping("/api/agents/{id}")
  Map<String, Object> update(@PathVariable String id, @RequestBody Map<String, Object> body, @RequestAttribute("ctx") Ctx ctx) {
    Map<String, Object> a = agents.updateInfo(id, body, ctx.dataUserId);
    logs.activity(ctx, "agent.update", (String) a.get("name"), J.map("id", id, "changed", body.keySet()));
    return agents.card(a);
  }

  @DeleteMapping("/api/agents/{id}")
  Map<String, Object> delete(@PathVariable String id, @RequestAttribute("ctx") Ctx ctx) {
    Map<String, Object> a = agents.delete(id, ctx.dataUserId);
    logs.activity(ctx, "agent.delete", (String) a.get("name"), J.map("id", id));
    return J.map("ok", true);
  }
}
