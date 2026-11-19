package com.telemune.smartai.ai;

import com.telemune.smartai.util.J;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Speech providers. Text-to-speech: OpenAI, Amazon Polly, ElevenLabs, Cartesia. Speech-to-text: OpenAI, ElevenLabs
 * Scribe, Amazon Transcribe (streaming). Keys: OPENAI_API_KEY in .env, the others in keys.env (aws.*, elevenlabs.*,
 * cartesia.*). A provider without its key is shown as "not set up" and is never called.
 * Which languages each provider handles is listed in LANGS (base language codes, approximate; check provider docs).
 */
@Service
public class SpeechService {
  private static final Logger log = LoggerFactory.getLogger(SpeechService.class);
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build();
  private final Environment env;
  private final OpenAiClient openai;
  private final Map<String, CachedVoices> voiceCache = new ConcurrentHashMap<>();

  private record CachedVoices(long at, List<Map<String, Object>> voices) {}

  public SpeechService(Environment env, OpenAiClient openai) {
    this.env = env;
    this.openai = openai;
  }

  /** An error from a speech provider (status 0 = network / not set up). */
  public static class SpeechException extends RuntimeException {
    public final int status;
    public final String provider;

    public SpeechException(String provider, int status, String message) {
      super(message);
      this.provider = provider;
      this.status = status;
    }
  }

  // ---------- what each provider can do ----------
  public static final List<String> TTS = List.of("openai", "aws", "elevenlabs", "cartesia");
  public static final List<String> STT = List.of("openai", "elevenlabs", "aws");
  private static final Map<String, String> LABEL = Map.of("openai", "OpenAI", "aws", "AWS", "elevenlabs", "ElevenLabs", "cartesia", "Cartesia");
  private static final Map<String, List<String>> TTS_MODELS = Map.of(
      "aws", List.of("neural", "generative"),
      "elevenlabs", List.of("eleven_flash_v2_5", "eleven_multilingual_v2", "eleven_turbo_v2_5"),
      "cartesia", List.of("sonic-2", "sonic-turbo"));
  private static final Map<String, List<String>> STT_MODELS = Map.of(
      "elevenlabs", List.of("scribe_v1"),
      "aws", List.of("streaming"));

  /** Base language codes each provider supports ("*" = all the app offers). Approximate: confirm in provider docs. */
  private static final Map<String, Set<String>> TTS_LANGS = Map.of(
      "openai", Set.of("*"),
      "aws", Set.of("en", "hi", "ar", "zh", "yue", "nl", "fr", "de", "it", "ja", "ko", "pl", "pt", "es", "sv", "tr"),
      "elevenlabs", Set.of("en", "ja", "zh", "de", "hi", "fr", "ko", "pt", "it", "es", "id", "nl", "tr", "fil", "pl", "sv", "ms", "cs", "ro",
          "ar", "el", "ta", "uk", "ru", "hu", "vi"),
      "cartesia", Set.of("en", "fr", "de", "es", "pt", "zh", "ja", "hi", "it", "ko", "nl", "pl", "ru", "sv", "tr"));
  private static final Map<String, Set<String>> STT_LANGS = Map.of(
      "openai", Set.of("*"),
      "elevenlabs", Set.of("*"),
      "aws", Set.of("en", "hi", "es", "fr", "de", "it", "pt", "ja", "ko", "zh", "th", "ar", "nl", "ru", "sv", "tr", "pl", "id", "ms", "vi",
          "fa", "uk", "cs", "ro", "el", "hu", "ta", "te"));

  public static String base(String lang) {
    String l = lang == null ? "" : lang.toLowerCase();
    if (l.startsWith("yue")) return "yue";
    if (l.startsWith("fil")) return "fil";
    return l.contains("-") ? l.substring(0, l.indexOf('-')) : l;
  }

  // ---------- keys ----------
  private String prop(String k) {
    String v = env.getProperty(k);
    return v == null ? "" : v.trim();
  }

  Aws.Creds aws() {
    return new Aws.Creds(prop("aws.access-key"), prop("aws.secret-key"), prop("aws.region").isEmpty() ? "ap-south-1" : prop("aws.region"));
  }

  public boolean ready(String provider) {
    return switch (provider) {
      case "openai" -> openai.hasKey();
      case "aws" -> aws().ok();
      case "elevenlabs" -> !prop("elevenlabs.api-key").isEmpty();
      case "cartesia" -> !prop("cartesia.api-key").isEmpty();
      default -> false;
    };
  }

  public String ttsProvider(Object p) {
    String s = J.str(p);
    return TTS.contains(s) ? s : "openai";
  }

  public String sttProvider(Object p) {
    String s = J.str(p);
    return STT.contains(s) ? s : "openai";
  }

  /** For the browser: providers, whether they're set up, their models and languages. */
  public Map<String, Object> providers() {
    Map<String, Object> tts = new LinkedHashMap<>(), stt = new LinkedHashMap<>();
    for (String p : TTS) tts.put(p, J.map("label", LABEL.get(p), "ready", ready(p), "models", TTS_MODELS.getOrDefault(p, List.of()), "langs", new ArrayList<>(TTS_LANGS.get(p))));
    for (String p : STT) stt.put(p, J.map("label", LABEL.get(p), "ready", ready(p), "models", STT_MODELS.getOrDefault(p, List.of()), "langs", new ArrayList<>(STT_LANGS.get(p))));
    return J.map("tts", tts, "stt", stt);
  }

  // ---------- HTTP helpers ----------
  private InputStream stream(String provider, HttpRequest req) {
    try {
      HttpResponse<InputStream> res = http.send(req, HttpResponse.BodyHandlers.ofInputStream());
      if (res.statusCode() / 100 != 2) {
        String body;
        try (InputStream in = res.body()) { body = new String(in.readAllBytes(), StandardCharsets.UTF_8); }
        throw new SpeechException(provider, res.statusCode(), errorText(body));
      }
      return res.body();
    } catch (IOException e) {
      throw new SpeechException(provider, 0, e.getMessage());
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new SpeechException(provider, 0, "interrupted");
    }
  }

  private String text(String provider, HttpRequest req) {
    try (InputStream in = stream(provider, req)) {
      return new String(in.readAllBytes(), StandardCharsets.UTF_8);
    } catch (IOException e) {
      throw new SpeechException(provider, 0, e.getMessage());
    }
  }

  private static String errorText(String body) {
    Object j = J.parse(body);
    if (j instanceof Map<?, ?>) {
      Map<String, Object> m = J.obj(j);
      Object d = m.get("detail");
      if (d instanceof Map<?, ?>) return J.str(J.obj(d).get("message"), 300);
      for (String k : List.of("message", "Message", "error", "detail")) if (!J.blank(m.get(k))) return J.str(m.get(k), 300);
    }
    return J.str(body, 300);
  }

  // ---------- text-to-speech ----------
  /** One sentence of speech as an mp3 stream. voice/model are the provider's; lang is the app language (e.g. hi-IN). */
  public InputStream speak(String provider, String model, String voice, String text, String lang, String instructions) {
    long t0 = System.nanoTime();
    InputStream out = switch (provider) {
      case "elevenlabs" -> elevenSpeak(model, voice, text, lang);
      case "cartesia" -> cartesiaSpeak(model, voice, text, lang);
      case "aws" -> pollySpeak(model, voice, text, lang);
      default -> throw new IllegalArgumentException("openai speech goes through OpenAiClient");
    };
    log.info("{} speech: model {}, voice {}, {} chars, headers in {} ms", LABEL.get(provider), model, voice, text.length(), (System.nanoTime() - t0) / 1_000_000);
    return out;
  }

  private InputStream elevenSpeak(String model, String voice, String text, String lang) {
    String m = J.blank(model) ? "eleven_flash_v2_5" : model;
    Map<String, Object> body = J.map("text", text, "model_id", m);
    if (m.contains("v2_5")) body.put("language_code", base(lang)); // only the v2.5 models take a language hint
    HttpRequest req = HttpRequest.newBuilder(URI.create("https://api.elevenlabs.io/v1/text-to-speech/" + enc(voice) + "/stream?output_format=mp3_44100_128"))
        .timeout(Duration.ofSeconds(60)).header("xi-api-key", prop("elevenlabs.api-key")).header("Content-Type", "application/json")
        .header("Accept", "audio/mpeg").POST(HttpRequest.BodyPublishers.ofString(J.json(body))).build();
    return stream("elevenlabs", req);
  }

  private InputStream cartesiaSpeak(String model, String voice, String text, String lang) {
    Map<String, Object> body = J.map("model_id", J.blank(model) ? "sonic-2" : model, "transcript", text,
        "voice", J.map("mode", "id", "id", voice),
        "output_format", J.map("container", "mp3", "sample_rate", 44100, "bit_rate", 128000),
        "language", base(lang));
    HttpRequest req = HttpRequest.newBuilder(URI.create("https://api.cartesia.ai/tts/bytes")).timeout(Duration.ofSeconds(60))
        .header("X-API-Key", prop("cartesia.api-key")).header("Cartesia-Version", "2025-04-16").header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(J.json(body))).build();
    return stream("cartesia", req);
  }

  /** Polly language code for an app language (Polly needs it for bilingual voices like Kajal: en-IN / hi-IN). */
  static String pollyLang(String lang) {
    return switch (lang == null ? "" : lang) {
      case "ar-SA" -> "arb";
      case "zh-CN" -> "cmn-CN";
      case "yue-HK" -> "yue-CN";
      case "en-JM" -> "en-US";
      default -> lang == null || lang.isEmpty() ? "en-US" : lang;
    };
  }

  private InputStream pollySpeak(String model, String voice, String text, String lang) {
    Aws.Creds c = aws();
    String host = "polly." + c.region() + ".amazonaws.com";
    Map<String, Object> body = J.map("Engine", J.blank(model) ? "neural" : model, "OutputFormat", "mp3", "SampleRate", "24000",
        "Text", text, "VoiceId", voice, "LanguageCode", pollyLang(lang));
    byte[] b = J.json(body).getBytes(StandardCharsets.UTF_8);
    Map<String, String> h = Aws.signHeaders(c, "polly", "POST", host, "/v1/speech", "", Map.of("content-type", "application/json"), b);
    HttpRequest.Builder rb = HttpRequest.newBuilder(URI.create("https://" + host + "/v1/speech")).timeout(Duration.ofSeconds(60));
    h.forEach(rb::header);
    InputStream in = stream("aws", rb.POST(HttpRequest.BodyPublishers.ofByteArray(b)).build());
    return in;
  }

  // ---------- voices ----------
  /** The provider's voices as [{id, label}]; label ends with "(male)" / "(female)" when known (the web app's character uses it). */
  public List<Map<String, Object>> voices(String provider, String lang) {
    if ("openai".equals(provider)) {
      List<Map<String, Object>> out = new ArrayList<>();
      Prompts.VOICES.forEach((id, label) -> out.add(J.map("id", id, "label", label)));
      return out;
    }
    if (!ready(provider)) return List.of();
    String key = provider + "|" + ("aws".equals(provider) ? pollyLang(lang) : "");
    CachedVoices hit = voiceCache.get(key);
    if (hit != null && System.currentTimeMillis() - hit.at() < 600_000) return hit.voices();
    List<Map<String, Object>> out = switch (provider) {
      case "elevenlabs" -> elevenVoices();
      case "cartesia" -> cartesiaVoices();
      case "aws" -> pollyVoices(lang);
      default -> List.of();
    };
    voiceCache.put(key, new CachedVoices(System.currentTimeMillis(), out));
    log.info("{} voices loaded: {}", LABEL.get(provider), out.size());
    return out;
  }

  private static String gender(Object g) {
    String s = J.str(g).toLowerCase();
    return s.startsWith("fem") || s.equals("female") || s.equals("woman") ? "female" : s.startsWith("masc") || s.equals("male") || s.equals("man") ? "male" : "";
  }

  private static String label(String name, String desc, String gender) {
    String d = desc == null ? "" : desc.replaceAll("\\s+", " ").trim();
    if (d.length() > 50) d = d.substring(0, 47) + "…";
    return name + (d.isEmpty() ? "" : " — " + d) + (gender.isEmpty() ? "" : " (" + gender + ")");
  }

  private List<Map<String, Object>> elevenVoices() {
    HttpRequest req = HttpRequest.newBuilder(URI.create("https://api.elevenlabs.io/v1/voices")).timeout(Duration.ofSeconds(20))
        .header("xi-api-key", prop("elevenlabs.api-key")).GET().build();
    List<Map<String, Object>> out = new ArrayList<>();
    for (Object o : J.list(J.obj(J.parse(text("elevenlabs", req))).get("voices"))) {
      Map<String, Object> v = J.obj(o), l = J.obj(v.get("labels"));
      String desc = String.join(", ", List.of(J.str(l.get("descriptive")), J.str(l.get("description")), J.str(l.get("accent"))).stream().filter(s -> !s.isBlank()).toList());
      out.add(J.map("id", v.get("voice_id"), "label", label(J.str(v.get("name")), desc, gender(l.get("gender")))));
    }
    return out;
  }

  private List<Map<String, Object>> cartesiaVoices() {
    HttpRequest req = HttpRequest.newBuilder(URI.create("https://api.cartesia.ai/voices/?limit=100")).timeout(Duration.ofSeconds(20))
        .header("X-API-Key", prop("cartesia.api-key")).header("Cartesia-Version", "2025-04-16").GET().build();
    Object j = J.parse(text("cartesia", req));
    List<Object> list = j instanceof Map<?, ?> ? J.list(J.obj(j).get("data")) : J.list(j);
    List<Map<String, Object>> out = new ArrayList<>();
    for (Object o : list) {
      Map<String, Object> v = J.obj(o);
      String g = gender(v.get("gender"));
      if (g.isEmpty()) { // no gender field: guess from the description
        String d = (J.str(v.get("description")) + " " + J.str(v.get("name"))).toLowerCase();
        g = d.matches(".*\\b(woman|female|lady|girl|she|her)\\b.*") ? "female" : d.matches(".*\\b(man|male|guy|boy|he|his)\\b.*") ? "male" : "";
      }
      String langTag = J.str(v.get("language"));
      out.add(J.map("id", v.get("id"), "label", label(J.str(v.get("name")), J.str(v.get("description")), g), "lang", langTag));
    }
    return out;
  }

  private List<Map<String, Object>> pollyVoices(String lang) {
    Aws.Creds c = aws();
    String host = "polly." + c.region() + ".amazonaws.com";
    String q = "Engine=neural&LanguageCode=" + Aws.enc(pollyLang(lang));
    Map<String, String> h = Aws.signHeaders(c, "polly", "GET", host, "/v1/voices", q, null, null);
    HttpRequest.Builder rb = HttpRequest.newBuilder(URI.create("https://" + host + "/v1/voices?" + q)).timeout(Duration.ofSeconds(20));
    h.forEach(rb::header);
    List<Map<String, Object>> out = new ArrayList<>();
    for (Object o : J.list(J.obj(J.parse(text("aws", rb.GET().build()))).get("Voices"))) {
      Map<String, Object> v = J.obj(o);
      out.add(J.map("id", v.get("Id"), "label", label(J.str(v.get("Name")), J.str(v.get("LanguageName")), gender(v.get("Gender")))));
    }
    return out;
  }

  // ---------- speech-to-text ----------
  /** Transcribe one utterance with ElevenLabs or AWS. audio = the browser's recording (WAV/PCM for AWS). */
  public String transcribe(String provider, String model, byte[] audio, String fileName, String mime, String lang) {
    long t0 = System.nanoTime();
    String out = switch (provider) {
      case "elevenlabs" -> elevenTranscribe(model, audio, fileName, mime, lang);
      case "aws" -> {
        try {
          yield AwsTranscribe.transcribe(aws(), audio, awsLang(lang));
        } catch (Exception e) {
          throw new SpeechException("aws", 0, e.getMessage());
        }
      }
      default -> throw new IllegalArgumentException("openai transcription goes through OpenAiClient");
    };
    log.info("{} transcribe: {} KB in {} ms", LABEL.get(provider), audio.length / 1024, (System.nanoTime() - t0) / 1_000_000);
    log.debug("Transcript: \"{}\"", out);
    return out;
  }

  /** Transcribe language code for an app language. */
  static String awsLang(String lang) {
    return switch (lang == null ? "" : lang) {
      case "", "en-JM" -> "en-US";
      case "es-ES" -> "es-US";
      case "fil-PH", "yue-HK" -> "en-US";
      default -> lang;
    };
  }

  private String elevenTranscribe(String model, byte[] audio, String fileName, String mime, String lang) {
    String boundary = "----tsa" + UUID.randomUUID().toString().replace("-", "");
    ByteArrayOutputStream body = new ByteArrayOutputStream();
    java.util.function.Consumer<String> w = s -> body.writeBytes(s.getBytes(StandardCharsets.UTF_8));
    List<String[]> fields = new ArrayList<>();
    fields.add(new String[]{"model_id", J.blank(model) || !model.startsWith("scribe") ? "scribe_v1" : model});
    if (!base(lang).isEmpty() && !"en-JM".equals(lang)) fields.add(new String[]{"language_code", base(lang)});
    for (String[] f : fields) w.accept("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + f[0] + "\"\r\n\r\n" + f[1] + "\r\n");
    w.accept("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" + fileName + "\"\r\nContent-Type: " + mime + "\r\n\r\n");
    body.writeBytes(audio);
    w.accept("\r\n--" + boundary + "--\r\n");
    HttpRequest req = HttpRequest.newBuilder(URI.create("https://api.elevenlabs.io/v1/speech-to-text")).timeout(Duration.ofSeconds(60))
        .header("xi-api-key", prop("elevenlabs.api-key")).header("Content-Type", "multipart/form-data; boundary=" + boundary)
        .POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray())).build();
    return J.str(J.obj(J.parse(text("elevenlabs", req))).get("text")).trim();
  }

  private static String enc(String s) {
    return URLEncoder.encode(s == null ? "" : s, StandardCharsets.UTF_8);
  }

  /** A short message for the user. */
  public static String friendly(SpeechException e) {
    String who = LABEL.getOrDefault(e.provider, e.provider);
    if (e.status == 401 || e.status == 403) return who + " refused the key (check keys.env and the key's permissions): " + e.getMessage();
    if (e.status == 429) return who + " says too many requests or no credit left.";
    if (e.status == 0) return who + " couldn't be reached: " + e.getMessage();
    return who + " error " + e.status + ": " + e.getMessage();
  }

}
