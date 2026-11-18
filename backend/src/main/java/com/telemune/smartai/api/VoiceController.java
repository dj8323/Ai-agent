package com.telemune.smartai.api;

import com.telemune.smartai.ai.OpenAiClient;
import com.telemune.smartai.ai.Prompts;
import com.telemune.smartai.service.AppConfigService;
import com.telemune.smartai.service.PlaybookService;
import com.telemune.smartai.service.TemplateService;
import com.telemune.smartai.util.J;
import com.telemune.smartai.web.ApiException;
import com.telemune.smartai.web.Ctx;
import jakarta.servlet.ServletOutputStream;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/** The live call: streamed replies (SSE), text-to-speech, speech-to-text, and the end-of-call summary. */
@RestController
public class VoiceController {
  private static final Logger log = LoggerFactory.getLogger(VoiceController.class);
  private static final Map<String, String> AUDIO_EXT = Map.of("audio/webm", "webm", "audio/mp4", "mp4", "audio/ogg", "ogg", "audio/wav", "wav", "audio/mpeg", "mp3");

  private final AppConfigService config;
  private final TemplateService templates;
  private final PlaybookService playbooks;
  private final OpenAiClient openai;

  public VoiceController(AppConfigService config, TemplateService templates, PlaybookService playbooks, OpenAiClient openai) {
    this.config = config;
    this.templates = templates;
    this.playbooks = playbooks;
    this.openai = openai;
  }

  /** Recent user/assistant turns (the model must see a user turn first). */
  static List<Map<String, Object>> cleanTurns(Object raw, Map<String, Object> cfg) {
    List<Map<String, Object>> out = new ArrayList<>();
    for (Object o : J.list(raw)) {
      Map<String, Object> m = J.obj(o);
      Object role = m.get("role");
      if (("user".equals(role) || "assistant".equals(role)) && m.get("content") instanceof String s && !s.isBlank()) out.add(J.map("role", role, "content", s));
    }
    long keep = J.num(J.get(cfg, "conversation.historyTurnsSentToModel"));
    if (keep <= 0) keep = 30;
    if (out.size() > keep) out = new ArrayList<>(out.subList((int) (out.size() - keep), out.size()));
    if (!out.isEmpty() && "assistant".equals(out.get(0).get("role"))) out.add(0, J.map("role", "user", "content", "[call connected]"));
    return out;
  }

  private static Map<String, Object> usage(Object u) {
    Map<String, Object> m = J.obj(u);
    return J.map("input", J.num(m.get("prompt_tokens")), "output", J.num(m.get("completion_tokens")), "total", J.num(m.get("total_tokens")));
  }

  private static void sse(ServletOutputStream out, String event, Object payload) {
    try {
      out.write(("event: " + event + "\ndata: " + J.json(payload) + "\n\n").getBytes(StandardCharsets.UTF_8));
      out.flush();
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  private Map<String, Object> chatBody(Map<String, Object> cfg, List<Map<String, Object>> messages) {
    Map<String, Object> body = J.map("model", J.get(cfg, "models.chat"), "max_completion_tokens", J.num(J.get(cfg, "models.maxReplyTokens")), "messages", messages);
    String effort = J.str(J.get(cfg, "models.reasoningEffort"));
    if (!effort.isEmpty()) body.put("reasoning_effort", effort);
    return body;
  }

  @PostMapping("/api/chat")
  void chat(@RequestBody Map<String, Object> body, @RequestAttribute("ctx") Ctx ctx, HttpServletResponse res) throws IOException {
    Map<String, Object> cfg = config.forAgent(ctx.agent);
    List<Map<String, Object>> turns = cleanTurns(body.get("messages"), cfg);
    if (turns.isEmpty() || !"user".equals(turns.get(turns.size() - 1).get("role"))) throw ApiException.bad("Last message must be from the user");
    Map<String, Object> pb = playbooks.get(body.get("playbookId"), ctx.dataUserId);
    String name = J.blank(body.get("assistantName")) ? J.str(J.get(cfg, "agent.defaultName")) : J.str(body.get("assistantName"), 40);
    String lang = J.str(body.get("lang"));
    String owner = ctx.agent == null ? "" : J.str(ctx.agent.get("owner_name"));
    String system = Prompts.system(lang, name, templates.rolePrompt(ctx.agent, pb, name), templates.greeting(ctx.agent, name), owner, cfg);

    List<Map<String, Object>> messages = new ArrayList<>();
    messages.add(J.map("role", "system", "content", system));
    messages.addAll(turns);
    // The browser spotted an emergency keyword in this message: make sure the reply leads with the number.
    Map<String, Object> emg = J.obj(body.get("emergency"));
    if (!J.blank(emg.get("number"))) {
      messages.add(J.map("role", "system", "content", "EMERGENCY DETECTED (" + J.str(emg.get("label"), 40) + "). Your reply must start by telling the caller to call "
          + J.str(emg.get("number"), 20) + " right now."));
    }
    Map<String, Object> req = chatBody(cfg, messages);
    req.put("stream", true);
    req.put("stream_options", J.map("include_usage", true)); // last chunk carries token usage

    res.setStatus(200);
    res.setContentType("text/event-stream");
    res.setCharacterEncoding("UTF-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");
    ServletOutputStream out = res.getOutputStream();
    out.flush();
    AtomicBoolean alive = new AtomicBoolean(true);
    try {
      openai.chatStream(req, chunk -> {
        for (Object c : J.list(chunk.get("choices"))) {
          Object text = J.get(J.obj(c), "delta.content");
          if (text instanceof String s && !s.isEmpty()) sse(out, "delta", J.map("text", s));
        }
        if (chunk.get("usage") instanceof Map<?, ?>) sse(out, "usage", usage(chunk.get("usage")));
      }, alive::get);
      sse(out, "done", J.map());
    } catch (UncheckedIOException e) {
      alive.set(false); // the caller hung up
    } catch (OpenAiClient.OpenAiException e) {
      log.warn("chat failed: {} {}", e.status, e.getMessage());
      try {
        sse(out, "error", J.map("message", OpenAiClient.friendly(e)));
      } catch (UncheckedIOException ignored) { }
    } catch (Exception e) {
      log.error("chat failed", e);
      try {
        sse(out, "error", J.map("message", "Something went wrong talking to the agent."));
      } catch (UncheckedIOException ignored) { }
    }
  }

  @PostMapping("/api/summary")
  ResponseEntity<Map<String, Object>> summary(@RequestBody Map<String, Object> body, @RequestAttribute("ctx") Ctx ctx) {
    Map<String, Object> cfg = config.forAgent(ctx.agent);
    StringBuilder transcript = new StringBuilder();
    for (Map<String, Object> m : cleanTurns(body.get("messages"), cfg)) {
      String content = (String) m.get("content");
      if ("[call connected]".equals(content)) continue;
      String clean = content.replaceAll("(?i)<[a-z]+:[^>]*>|\\[[a-z]+]", "").trim();
      transcript.append("user".equals(m.get("role")) ? "Caller: " : "Agent: ").append(clean).append("\n");
    }
    Map<String, Object> pb = playbooks.get(body.get("playbookId"), ctx.dataUserId);
    String focus = templates.summaryFocus(ctx.agent, pb);
    if (focus == null) focus = "The caller's requests, important details mentioned, and anything promised.";
    String owner = ctx.agent == null ? "" : J.str(ctx.agent.get("owner_name"));
    String sys = "You write short call summaries for a voice agent" + (pb != null ? " running the \"" + pb.get("name") + "\" playbook" : "")
        + (owner.isEmpty() ? "" : " that answers calls for " + owner) + ". Write in English, plain text, no markdown symbols like # or *.\n"
        + "Use exactly these sections, each starting on its own line:\n"
        + "Summary: two or three sentences on what happened.\n"
        + "Caller intent: the main thing the caller wanted.\n"
        + "Caller mood: how they felt at the start and at the end.\n"
        + "Key details: " + focus + " Use \"- \" lines; skip anything not mentioned.\n"
        + "Action items: \"- \" lines, or \"- None\".\n"
        + "Outcome: one line.";
    Map<String, Object> cfgModels = J.map("role", "user", "content", "Call duration: " + (J.blank(body.get("duration")) ? "unknown" : J.str(body.get("duration"))) + "\n\nTranscript:\n" + transcript);
    Map<String, Object> req = chatBody(cfg, List.of(J.map("role", "system", "content", sys), cfgModels));
    req.put("max_completion_tokens", J.num(J.get(cfg, "models.maxSummaryTokens")));
    try {
      Map<String, Object> outRes = openai.chat(req);
      Object content = J.get(J.obj(J.list(outRes.get("choices")).stream().findFirst().orElse(null)), "message.content");
      String text = J.str(content);
      return ResponseEntity.ok(J.map("summary", text.isEmpty() ? "No summary." : text, "usage", usage(outRes.get("usage"))));
    } catch (OpenAiClient.OpenAiException e) {
      log.warn("summary failed: {} {}", e.status, e.getMessage());
      return ResponseEntity.status(502).body(J.map("error", OpenAiClient.friendly(e)));
    }
  }

  @PostMapping("/api/tts")
  ResponseEntity<?> tts(@RequestBody Map<String, Object> body, @RequestAttribute("ctx") Ctx ctx) {
    String text = J.str(body.get("text"), 1500);
    if (text.isEmpty()) throw ApiException.bad("No text");
    String voice = Prompts.VOICES.containsKey(J.str(body.get("voice"))) ? J.str(body.get("voice")) : "marin";
    String emotion = Prompts.EMOTIONS.containsKey(J.str(body.get("emotion"))) ? J.str(body.get("emotion")) : "neutral";
    String lang = J.str(body.get("lang"));
    String model = J.str(J.get(config.forAgent(ctx.agent), "models.tts"));
    boolean legacy = model.startsWith("tts-1"); // tts-1 / tts-1-hd: no emotion instructions, older voice set
    Map<String, Object> req = J.map("model", model, "voice", legacy && !Prompts.LEGACY_VOICES.contains(voice) ? "alloy" : voice, "input", text, "response_format", "mp3");
    if (!legacy) req.put("instructions", "You are a voice agent on a phone call. " + Prompts.voiceStyle(lang) + " " + Prompts.EMOTIONS.get(emotion));
    try {
      byte[] mp3 = openai.speech(req);
      return ResponseEntity.ok().contentType(MediaType.parseMediaType("audio/mpeg")).header("Cache-Control", "no-store").body(mp3);
    } catch (OpenAiClient.OpenAiException e) {
      log.warn("tts failed: {} {}", e.status, e.getMessage());
      return ResponseEntity.status(502).contentType(MediaType.TEXT_PLAIN).body(OpenAiClient.friendly(e));
    }
  }

  /** Speech-to-text for one caller utterance. Body: { audio: base64, mime, lang, context }. */
  @PostMapping("/api/transcribe")
  ResponseEntity<Map<String, Object>> transcribe(@RequestBody Map<String, Object> body, @RequestAttribute("ctx") Ctx ctx) {
    Map<String, Object> cfg = config.forAgent(ctx.agent);
    byte[] audio;
    try {
      audio = Base64.getDecoder().decode(J.str(body.get("audio")));
    } catch (IllegalArgumentException e) {
      throw ApiException.bad("Bad request");
    }
    if (audio.length < 1000) return ResponseEntity.ok(J.map("text", "")); // too short to contain speech
    String mime = J.str(body.get("mime")).split(";")[0].trim();
    if (mime.isEmpty()) mime = "audio/webm";
    String ext = AUDIO_EXT.getOrDefault(mime, "webm");
    String lang = J.str(body.get("lang"));
    String hint = "Phone call with a voice assistant. The caller usually speaks " + Prompts.language(lang)
        + ("en-JM".equals(lang) ? " (write it in natural Patois spelling as spoken)" : "")
        + ", and may mix in English or other languages; transcribe exactly what they say, in the language they say it."
        + (J.blank(body.get("context")) ? "" : " The assistant just said: \"" + J.str(body.get("context"), 300) + "\"");
    try {
      return ResponseEntity.ok(J.map("text", openai.transcribe(audio, "speech." + ext, mime, J.str(J.get(cfg, "speechToText.model")), hint).trim()));
    } catch (OpenAiClient.OpenAiException e) {
      log.warn("transcribe failed: {} {}", e.status, e.getMessage());
      return ResponseEntity.status(502).body(J.map("error", OpenAiClient.friendly(e)));
    }
  }
}
