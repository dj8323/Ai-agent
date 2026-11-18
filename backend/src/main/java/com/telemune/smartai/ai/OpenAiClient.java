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
    return new OpenAiException(status, msg.isEmpty() ? "HTTP " + status : msg);
  }

  private <T> HttpResponse<T> send(HttpRequest r, HttpResponse.BodyHandler<T> h) {
    try {
      return http.send(r, h);
    } catch (IOException e) {
      throw new OpenAiException(0, e.getMessage());
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new OpenAiException(0, "interrupted");
    }
  }

  /** Non-streamed chat completion → the full JSON response. */
  public Map<String, Object> chat(Map<String, Object> body) {
    HttpResponse<String> res = send(req("/chat/completions", Duration.ofMinutes(3)).header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(J.json(body))).build(), HttpResponse.BodyHandlers.ofString());
    if (res.statusCode() >= 300) throw error(res.statusCode(), res.body());
    return J.obj(res.body());
  }

  /**
   * Streamed chat completion: onChunk gets every parsed chunk. Return false from keepGoing to stop early
   * (the caller hung up); the upstream request is then closed.
   */
  public void chatStream(Map<String, Object> body, Consumer<Map<String, Object>> onChunk, java.util.function.BooleanSupplier keepGoing) {
    HttpResponse<Stream<String>> res = send(req("/chat/completions", Duration.ofMinutes(3)).header("Content-Type", "application/json")
        .header("Accept", "text/event-stream").POST(HttpRequest.BodyPublishers.ofString(J.json(body))).build(), HttpResponse.BodyHandlers.ofLines());
    try (Stream<String> lines = res.body()) {
      if (res.statusCode() >= 300) {
        StringBuilder sb = new StringBuilder();
        lines.forEach(sb::append);
        throw error(res.statusCode(), sb.toString());
      }
      var it = lines.iterator();
      while (it.hasNext()) {
        if (!keepGoing.getAsBoolean()) return;
        String line = it.next();
        if (!line.startsWith("data:")) continue;
        String data = line.substring(5).trim();
        if (data.equals("[DONE]")) return;
        onChunk.accept(J.obj(data));
      }
    }
  }

  /** Text to speech → mp3 bytes. */
  public byte[] speech(Map<String, Object> body) {
    HttpResponse<byte[]> res = send(req("/audio/speech", Duration.ofMinutes(2)).header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(J.json(body))).build(), HttpResponse.BodyHandlers.ofByteArray());
    if (res.statusCode() >= 300) throw error(res.statusCode(), new String(res.body(), StandardCharsets.UTF_8));
    return res.body();
  }

  /** Text to speech, streamed: the caller reads the mp3 as OpenAI produces it (first audio ~0.3 s sooner). */
  public java.io.InputStream speechStream(Map<String, Object> body) {
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
    HttpResponse<String> res = send(req("/audio/transcriptions", Duration.ofMinutes(2)).header("Content-Type", "multipart/form-data; boundary=" + boundary)
        .POST(HttpRequest.BodyPublishers.ofByteArray(out.toByteArray())).build(), HttpResponse.BodyHandlers.ofString());
    if (res.statusCode() >= 300) throw error(res.statusCode(), res.body());
    return J.str(J.obj(res.body()).get("text"));
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
