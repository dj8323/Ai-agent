package com.telemune.smartai.ai;

import com.telemune.smartai.util.J;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.TimeUnit;
import java.util.zip.CRC32;

/**
 * Amazon Transcribe streaming over a pre-signed WebSocket (no SDK). The caller's utterance arrives as 16 kHz mono
 * 16-bit PCM (the browser converts it to WAV for this provider); it is sent as AWS "event stream" AudioEvent frames
 * and the final (non-partial) results are joined into the text.
 */
public final class AwsTranscribe {
  private static final Logger log = LoggerFactory.getLogger(AwsTranscribe.class);
  private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
  private static final int RATE = 16000;
  private static final int CHUNK = 3200; // 100 ms of 16-bit mono audio at 16 kHz

  private AwsTranscribe() {}

  /** PCM samples from a WAV file (the "data" chunk), or the bytes as they are if there is no RIFF header. */
  static byte[] pcm(byte[] wav) {
    if (wav.length < 44 || wav[0] != 'R' || wav[1] != 'I' || wav[2] != 'F' || wav[3] != 'F') return wav;
    int p = 12;
    while (p + 8 <= wav.length) {
      String id = new String(wav, p, 4, StandardCharsets.US_ASCII);
      int len = (wav[p + 4] & 0xff) | (wav[p + 5] & 0xff) << 8 | (wav[p + 6] & 0xff) << 16 | (wav[p + 7] & 0xff) << 24;
      if ("data".equals(id)) return java.util.Arrays.copyOfRange(wav, p + 8, Math.min(wav.length, p + 8 + len));
      p += 8 + len + (len & 1);
    }
    return wav;
  }

  /** One AWS event-stream message: prelude + CRC, string headers, payload, message CRC. */
  static byte[] message(Map<String, String> headers, byte[] payload) {
    ByteArrayOutputStream h = new ByteArrayOutputStream();
    headers.forEach((k, v) -> {
      byte[] kb = k.getBytes(StandardCharsets.UTF_8), vb = v.getBytes(StandardCharsets.UTF_8);
      h.write(kb.length);
      h.writeBytes(kb);
      h.write(7); // string
      h.write(vb.length >> 8);
      h.write(vb.length & 0xff);
      h.writeBytes(vb);
    });
    byte[] hb = h.toByteArray();
    int total = 12 + hb.length + payload.length + 4;
    ByteBuffer b = ByteBuffer.allocate(total);
    b.putInt(total).putInt(hb.length);
    CRC32 crc = new CRC32();
    crc.update(b.array(), 0, 8);
    b.putInt((int) crc.getValue());
    b.put(hb).put(payload);
    CRC32 all = new CRC32();
    all.update(b.array(), 0, total - 4);
    b.putInt((int) all.getValue());
    return b.array();
  }

  private static final Map<String, String> AUDIO_HEADERS = new java.util.LinkedHashMap<>(Map.of());
  static {
    AUDIO_HEADERS.put(":content-type", "application/octet-stream");
    AUDIO_HEADERS.put(":event-type", "AudioEvent");
    AUDIO_HEADERS.put(":message-type", "event");
  }

  /** Decoded server message: its headers and JSON payload. */
  record Msg(Map<String, String> headers, String payload) {}

  static Msg decode(byte[] m) {
    ByteBuffer b = ByteBuffer.wrap(m);
    int total = b.getInt(), hlen = b.getInt();
    b.getInt(); // prelude crc
    Map<String, String> h = new java.util.HashMap<>();
    int end = 12 + hlen;
    while (b.position() < end) {
      int kl = b.get() & 0xff;
      byte[] k = new byte[kl];
      b.get(k);
      int type = b.get() & 0xff;
      if (type == 7 || type == 6) { // string / bytes
        int vl = b.getShort() & 0xffff;
        byte[] v = new byte[vl];
        b.get(v);
        h.put(new String(k, StandardCharsets.UTF_8), new String(v, StandardCharsets.UTF_8));
      } else { // not used by Transcribe: skip fixed-size values
        int skip = switch (type) { case 0, 1 -> 0; case 2 -> 1; case 3 -> 2; case 4 -> 4; case 5, 8 -> 8; case 9 -> 16; default -> 0; };
        b.position(b.position() + skip);
      }
    }
    byte[] payload = new byte[total - end - 4];
    b.get(payload);
    return new Msg(h, new String(payload, StandardCharsets.UTF_8));
  }

  /** Transcribe one utterance. lang = Transcribe language code (e.g. en-IN, hi-IN). Throws on errors. */
  public static String transcribe(Aws.Creds creds, byte[] wav, String lang) throws Exception {
    byte[] pcm = pcm(wav);
    String host = "transcribestreaming." + creds.region() + ".amazonaws.com:8443";
    String url = Aws.presign(creds, "transcribe", "wss", host, "/stream-transcription-websocket",
        Map.of("language-code", lang, "media-encoding", "pcm", "sample-rate", String.valueOf(RATE)), 300);
    StringBuilder text = new StringBuilder();
    CompletableFuture<String> done = new CompletableFuture<>();
    ByteArrayOutputStream partial = new ByteArrayOutputStream();
    long t0 = System.nanoTime();

    WebSocket.Listener listener = new WebSocket.Listener() {
      @Override
      public CompletionStage<?> onBinary(WebSocket ws, ByteBuffer data, boolean last) {
        byte[] chunk = new byte[data.remaining()];
        data.get(chunk);
        partial.writeBytes(chunk);
        if (last) {
          try {
            Msg msg = decode(partial.toByteArray());
            partial.reset();
            String type = msg.headers().getOrDefault(":message-type", "");
            if ("exception".equals(type)) {
              done.completeExceptionally(new IllegalStateException(msg.headers().get(":exception-type") + ": " + J.str(J.obj(J.parse(msg.payload())).get("Message"))));
            } else if ("TranscriptEvent".equals(msg.headers().get(":event-type"))) {
              for (Object r : J.list(J.get(J.obj(J.parse(msg.payload())), "Transcript.Results"))) {
                Map<String, Object> res = J.obj(r);
                if (J.bool(res.get("IsPartial"))) continue;
                Object alt = J.list(res.get("Alternatives")).stream().findFirst().orElse(null);
                String t = J.str(J.obj(alt).get("Transcript"));
                if (!t.isEmpty()) text.append(text.isEmpty() ? "" : " ").append(t);
              }
            }
          } catch (Exception e) {
            done.completeExceptionally(e);
          }
        }
        ws.request(1);
        return null;
      }

      @Override
      public CompletionStage<?> onClose(WebSocket ws, int status, String reason) {
        done.complete(text.toString());
        return null;
      }

      @Override
      public void onError(WebSocket ws, Throwable error) {
        done.completeExceptionally(error);
      }
    };

    WebSocket ws = HTTP.newWebSocketBuilder().connectTimeout(Duration.ofSeconds(10)).buildAsync(URI.create(url), listener).get(10, TimeUnit.SECONDS);
    try {
      for (int i = 0; i < pcm.length; i += CHUNK) {
        byte[] part = java.util.Arrays.copyOfRange(pcm, i, Math.min(pcm.length, i + CHUNK));
        ws.sendBinary(ByteBuffer.wrap(message(AUDIO_HEADERS, part)), true).get(5, TimeUnit.SECONDS);
        if (done.isDone()) break; // the service already answered (an error)
        Thread.sleep(8); // a little faster than real time, which streaming accepts
      }
      ws.sendBinary(ByteBuffer.wrap(message(AUDIO_HEADERS, new byte[0])), true).get(5, TimeUnit.SECONDS); // end of audio
      String out = done.get(20, TimeUnit.SECONDS).trim();
      log.info("AWS transcribe {}: {} KB audio in {} ms", lang, pcm.length / 1024, (System.nanoTime() - t0) / 1_000_000);
      return out;
    } finally {
      ws.abort();
    }
  }
}
