package com.telemune.smartai.ai;

import com.telemune.smartai.util.J;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.stream.Stream;

/** Plain HTTPS calls to the OpenAI API (the key comes from OPENAI_API_KEY in .env). */
@Component
public class OpenAiClient {
  private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(OpenAiClient.class);
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(20)).build();
  private final String key;
  private final String base;

  public OpenAiClient(@Value("${openai.api-key:}") String key, @Value("${openai.base-url}") String base) {
    this.key = key == null ? "" : key.trim();
    this.base = base.replaceAll("/+$", "");
  }

  public boolean hasKey() {
    return !key.isEmpty();
  }

  /** An OpenAI error with its HTTP status (0 = network). */
  public static class OpenAiException extends RuntimeException {
    public final int status;

    public OpenAiException(int status, String message) {
      super(message);
      this.status = status;
    }
  }

  /** A message that is safe to show the user. */
  public static String friendly(Exception e) {
    if (e instanceof OpenAiException o) {
      if (o.status == 401) return "Server is missing a valid OPENAI_API_KEY.";
      if (o.status == 429) return "Rate limited or out of credit. Check your OpenAI billing and try again.";
      if (o.status == 404) return "A model in the settings (\"models\") isn't available on your OpenAI account.";
      if (o.status > 0) return "API error: " + o.getMessage();
    }
    return "Something went wrong talking to the agent.";
  }

  private HttpRequest.Builder req(String path, Duration timeout) {
    if (!hasKey()) throw new OpenAiException(401, "OPENAI_API_KEY is not set");
    return HttpRequest.newBuilder(URI.create(base + path)).timeout(timeout).header("Authorization", "Bearer " + key);
  }

  private static OpenAiException error(int status, String body) {
    String msg = J.str(J.get(J.obj(body), "error.message"));
    log.warn("OpenAI answered HTTP {}: {}", status, msg.isEmpty() ? J.str(body, 300) : msg);
    return new OpenAiException(status, msg.isEmpty() ? "HTTP " + status : msg);
  }

  private <T> HttpResponse<T> send(HttpRequest r, HttpResponse.BodyHandler<T> h) {
    long t0 = System.nanoTime();
    try {
      HttpResponse<T> res = http.send(r, h);
      log.debug("OpenAI {} {} → HTTP {} (headers in {} ms, request id {})", r.method(), r.uri().getPath(), res.statusCode(),
          (System.nanoTime() - t0) / 1_000_000, res.headers().firstValue("x-request-id").orElse("-"));
      return res;
    } catch (IOException e) {
      log.error("OpenAI {} {} network error after {} ms: {}", r.method(), r.uri().getPath(), (System.nanoTime() - t0) / 1_000_000, e.toString());
      throw new OpenAiException(0, e.getMessage());
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new OpenAiException(0, "interrupted");
    }
  }

  /** Non-streamed chat completion → the full JSON response. */
  public Map<String, Object> chat(Map<String, Object> body) {
    long t0 = System.nanoTime();
    HttpResponse<String> res = send(req("/chat/completions", Duration.ofMinutes(3)).header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(J.json(body))).build(), HttpResponse.BodyHandlers.ofString());
    if (res.statusCode() >= 300) throw error(res.statusCode(), res.body());
    Map<String, Object> out = J.obj(res.body());
    log.info("OpenAI chat {} in {} ms, tokens {}", body.get("model"), (System.nanoTime() - t0) / 1_000_000, J.get(out, "usage.total_tokens"));
    return out;
  }

  /**
   * Streamed chat completion: onChunk gets every parsed chunk. Return false from keepGoing to stop early
   * (the caller hung up); the upstream request is then closed.
   */
  public void chatStream(Map<String, Object> body, Consumer<Map<String, Object>> onChunk, java.util.function.BooleanSupplier keepGoing) {
    long t0 = System.nanoTime();
    log.debug("OpenAI chat stream: model {}, {} messages, max tokens {}, effort {}", body.get("model"), J.list(body.get("messages")).size(),
        body.get("max_completion_tokens"), body.getOrDefault("reasoning_effort", "-"));
    HttpResponse<Stream<String>> res = send(req("/chat/completions", Duration.ofMinutes(3)).header("Content-Type", "application/json")
        .header("Accept", "text/event-stream").POST(HttpRequest.BodyPublishers.ofString(J.json(body))).build(), HttpResponse.BodyHandlers.ofLines());
    try (Stream<String> lines = res.body()) {
      if (res.statusCode() >= 300) {
        StringBuilder sb = new StringBuilder();
        lines.forEach(sb::append);
        throw error(res.statusCode(), sb.toString());
      }
      var it = lines.iterator();
      long first = -1;
      Object tokens = null;
      String end = "finished";
      try {
        while (it.hasNext()) {
          if (!keepGoing.getAsBoolean()) {
            end = "stopped (caller hung up)";
            return;
          }
          String line = it.next();
          if (!line.startsWith("data:")) continue;
          String data = line.substring(5).trim();
          if (data.equals("[DONE]")) return;
          if (first < 0) first = (System.nanoTime() - t0) / 1_000_000;
          Map<String, Object> chunk = J.obj(data);
          if (chunk.get("usage") instanceof Map<?, ?> u) tokens = u.get("total_tokens");
          onChunk.accept(chunk);
        }
      } finally {
        log.info("OpenAI chat {} {}: first token {} ms, total {} ms, tokens {}", body.get("model"), end, first,
            (System.nanoTime() - t0) / 1_000_000, tokens == null ? "-" : tokens);
      }
    }
  }

  /** Text to speech → mp3 bytes. */
  public byte[] speech(Map<String, Object> body) {
    long t0 = System.nanoTime();
    HttpResponse<byte[]> res = send(req("/audio/speech", Duration.ofMinutes(2)).header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(J.json(body))).build(), HttpResponse.BodyHandlers.ofByteArray());
    if (res.statusCode() >= 300) throw error(res.statusCode(), new String(res.body(), StandardCharsets.UTF_8));
    log.info("OpenAI speech {} voice {}: {} chars → {} KB in {} ms", body.get("model"), body.get("voice"), J.str(body.get("input")).length(),
        res.body().length / 1024, (System.nanoTime() - t0) / 1_000_000);
    return res.body();
  }

  /** Text to speech, streamed: the caller reads the mp3 as OpenAI produces it (first audio ~0.3 s sooner). */
  public java.io.InputStream speechStream(Map<String, Object> body) {
    log.info("OpenAI speech stream {} voice {}: {} chars", body.get("model"), body.get("voice"), J.str(body.get("input")).length());
    HttpResponse<java.io.InputStream> res = send(req("/audio/speech", Duration.ofMinutes(2)).header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(J.json(body))).build(), HttpResponse.BodyHandlers.ofInputStream());
    if (res.statusCode() >= 300) {
      try (java.io.InputStream in = res.body()) {
        throw error(res.statusCode(), new String(in.readAllBytes(), StandardCharsets.UTF_8));
      } catch (IOException e) {
        throw new OpenAiException(res.statusCode(), "HTTP " + res.statusCode());
      }
    }
    return res.body();
  }

  /** Speech to text for one utterance (multipart upload). */
  public String transcribe(byte[] audio, String fileName, String mime, String model, String prompt) {
    String boundary = "----tsa" + UUID.randomUUID().toString().replace("-", "");
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    Consumer<String> w = s -> out.writeBytes(s.getBytes(StandardCharsets.UTF_8));
    for (String[] f : new String[][]{{"model", model}, {"prompt", prompt}, {"response_format", "json"}}) {
      w.accept("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + f[0] + "\"\r\n\r\n" + f[1] + "\r\n");
    }
    w.accept("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" + fileName + "\"\r\nContent-Type: " + mime + "\r\n\r\n");
    out.writeBytes(audio);
    w.accept("\r\n--" + boundary + "--\r\n");
    long t0 = System.nanoTime();
    HttpResponse<String> res = send(req("/audio/transcriptions", Duration.ofMinutes(2)).header("Content-Type", "multipart/form-data; boundary=" + boundary)
        .POST(HttpRequest.BodyPublishers.ofByteArray(out.toByteArray())).build(), HttpResponse.BodyHandlers.ofString());
    if (res.statusCode() >= 300) throw error(res.statusCode(), res.body());
    String text = J.str(J.obj(res.body()).get("text"));
    log.info("OpenAI transcribe {}: {} KB audio → {} chars in {} ms", model, audio.length / 1024, text.length(), (System.nanoTime() - t0) / 1_000_000);
    log.debug("Transcript: \"{}\"", text);
    return text;
  }

  /** Model ids on this account. */
  public List<String> models() {
    HttpResponse<String> res = send(req("/models", Duration.ofSeconds(20)).GET().build(), HttpResponse.BodyHandlers.ofString());
    if (res.statusCode() >= 300) throw error(res.statusCode(), res.body());
    List<String> ids = new ArrayList<>();
    for (Object o : J.list(J.obj(res.body()).get("data"))) ids.add(J.str(J.obj(o).get("id")));
    return ids;
  }
}
