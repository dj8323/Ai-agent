package com.telemune.smartai.ai;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.HexFormat;
import java.util.Map;
import java.util.TreeMap;

/**
 * AWS Signature Version 4, just enough for Polly (REST) and Transcribe streaming (pre-signed WebSocket URL).
 * No AWS SDK: keys come from keys.env (aws.access-key, aws.secret-key, aws.region).
 */
public final class Aws {
  private Aws() {}

  private static final DateTimeFormatter AMZ = DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'");
  private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("yyyyMMdd");

  public record Creds(String accessKey, String secretKey, String region) {
    public boolean ok() { return !accessKey.isBlank() && !secretKey.isBlank() && !region.isBlank(); }
  }

  static byte[] hmac(byte[] key, String msg) {
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(key, "HmacSHA256"));
      return mac.doFinal(msg.getBytes(StandardCharsets.UTF_8));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  static String sha256(byte[] data) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  static byte[] signingKey(Creds c, String day, String service) {
    return hmac(hmac(hmac(hmac(("AWS4" + c.secretKey()).getBytes(StandardCharsets.UTF_8), day), c.region()), service), "aws4_request");
  }

  static String enc(String s) {
    return URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20").replace("*", "%2A").replace("%7E", "~");
  }

  /** Headers (Authorization, X-Amz-Date, …) for one signed request. path must be URI-encoded already. */
  public static Map<String, String> signHeaders(Creds c, String service, String method, String host, String path, String query,
                                                Map<String, String> extra, byte[] body) {
    ZonedDateTime now = ZonedDateTime.now(ZoneOffset.UTC);
    String amz = now.format(AMZ), day = now.format(DAY);
    TreeMap<String, String> h = new TreeMap<>();
    h.put("host", host);
    h.put("x-amz-date", amz);
    if (extra != null) extra.forEach((k, v) -> h.put(k.toLowerCase(), v.trim()));
    StringBuilder canonHeaders = new StringBuilder();
    h.forEach((k, v) -> canonHeaders.append(k).append(':').append(v).append('\n'));
    String signed = String.join(";", h.keySet());
    String canon = String.join("\n", method, path, query == null ? "" : query, canonHeaders.toString(), signed, sha256(body == null ? new byte[0] : body));
    String scope = day + "/" + c.region() + "/" + service + "/aws4_request";
    String toSign = String.join("\n", "AWS4-HMAC-SHA256", amz, scope, sha256(canon.getBytes(StandardCharsets.UTF_8)));
    String sig = HexFormat.of().formatHex(hmac(signingKey(c, day, service), toSign));
    TreeMap<String, String> out = new TreeMap<>(h);
    out.remove("host");
    out.put("Authorization", "AWS4-HMAC-SHA256 Credential=" + c.accessKey() + "/" + scope + ", SignedHeaders=" + signed + ", Signature=" + sig);
    return out;
  }

  /** A pre-signed URL (query-string auth), e.g. for the Transcribe streaming WebSocket. params are not yet encoded. */
  public static String presign(Creds c, String service, String scheme, String host, String path, Map<String, String> params, int expiresSeconds) {
    ZonedDateTime now = ZonedDateTime.now(ZoneOffset.UTC);
    String amz = now.format(AMZ), day = now.format(DAY);
    String scope = day + "/" + c.region() + "/" + service + "/aws4_request";
    TreeMap<String, String> q = new TreeMap<>(params);
    q.put("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
    q.put("X-Amz-Credential", c.accessKey() + "/" + scope);
    q.put("X-Amz-Date", amz);
    q.put("X-Amz-Expires", String.valueOf(expiresSeconds));
    q.put("X-Amz-SignedHeaders", "host");
    StringBuilder qs = new StringBuilder();
    q.forEach((k, v) -> qs.append(qs.isEmpty() ? "" : "&").append(enc(k)).append('=').append(enc(v)));
    String canon = String.join("\n", "GET", path, qs.toString(), "host:" + host + "\n", "host", sha256(new byte[0]));
    String toSign = String.join("\n", "AWS4-HMAC-SHA256", amz, scope, sha256(canon.getBytes(StandardCharsets.UTF_8)));
    String sig = HexFormat.of().formatHex(hmac(signingKey(c, day, service), toSign));
    return scheme + "://" + host + path + "?" + qs + "&X-Amz-Signature=" + sig;
  }
}
