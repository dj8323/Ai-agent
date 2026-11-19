package com.telemune.smartai.util;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Small helpers for loosely-typed JSON maps and database rows (values arrive as Object). */
public final class J {
  private J() {}

  public static final ObjectMapper M = new ObjectMapper();

  /** Ordered map from key/value pairs; null values allowed (unlike Map.of). */
  public static LinkedHashMap<String, Object> map(Object... kv) {
    LinkedHashMap<String, Object> m = new LinkedHashMap<>();
    for (int i = 0; i + 1 < kv.length; i += 2) m.put(String.valueOf(kv[i]), kv[i + 1]);
    return m;
  }

  public static String newId() {
    return UUID.randomUUID().toString().substring(0, 8);
  }

  public static String str(Object v) {
    return v == null ? "" : String.valueOf(v).trim();
  }

  public static String str(Object v, int max) {
    String s = str(v);
    return s.length() > max ? s.substring(0, max) : s;
  }

  public static boolean blank(Object v) {
    return str(v).isEmpty();
  }

  public static long num(Object v) {
    if (v == null) return 0;
    if (v instanceof Boolean b) return b ? 1 : 0;
    if (v instanceof Number n) return Math.round(n.doubleValue());
    try {
      return Math.round(Double.parseDouble(String.valueOf(v).trim()));
    } catch (NumberFormatException e) {
      return 0;
    }
  }

  public static Double dbl(Object v) {
    if (v == null) return null;
    if (v instanceof Number n) return n.doubleValue();
    try {
      return Double.parseDouble(String.valueOf(v).trim());
    } catch (NumberFormatException e) {
      return null;
    }
  }

  public static Long numOrNull(Object v) {
    Double d = dbl(v);
    return d == null || d.isNaN() ? null : Math.round(d);
  }

  public static boolean bool(Object v) {
    if (v == null) return false;
    if (v instanceof Boolean b) return b;
    if (v instanceof Number n) return n.doubleValue() != 0;
    if (v instanceof BigDecimal b) return b.signum() != 0;
    String s = String.valueOf(v).trim().toLowerCase();
    return s.equals("true") || s.equals("1") || s.equals("yes") || s.equals("on");
  }

  /** DB DATETIME (UTC) → ISO string ending in Z, or null. */
  public static String iso(Object v) {
    if (v == null) return null;
    if (v instanceof LocalDateTime d) return d.toInstant(ZoneOffset.UTC).toString();
    if (v instanceof Timestamp t) return t.toLocalDateTime().toInstant(ZoneOffset.UTC).toString();
    if (v instanceof Instant i) return i.toString();
    return String.valueOf(v);
  }

  public static LocalDateTime nowUtc() {
    return LocalDateTime.now(ZoneOffset.UTC);
  }

  public static LocalDateTime utc(Instant i) {
    return LocalDateTime.ofInstant(i, ZoneOffset.UTC);
  }

  /** Parse an ISO date the browser sent (with Z or offset; plain local time is taken as UTC). Null if invalid. */
  public static Instant parseInstant(Object v) {
    String s = str(v);
    if (s.isEmpty()) return null;
    try {
      return Instant.parse(s);
    } catch (Exception ignored) { }
    try {
      return OffsetDateTime.parse(s).toInstant();
    } catch (Exception ignored) { }
    try {
      return LocalDateTime.parse(s).toInstant(ZoneOffset.UTC);
    } catch (Exception ignored) { }
    return null;
  }

  public static String json(Object v) {
    try {
      return M.writeValueAsString(v);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  /** JSON text (e.g. a JSON column) → Map / List / value, or null. Non-strings are returned as they are. */
  public static Object parse(Object v) {
    if (v == null) return null;
    if (!(v instanceof String s)) return v;
    try {
      return M.readValue(s, Object.class);
    } catch (Exception e) {
      return null;
    }
  }

  @SuppressWarnings("unchecked")
  public static Map<String, Object> obj(Object v) {
    Object p = v instanceof String ? parse(v) : v;
    return p instanceof Map<?, ?> m ? (Map<String, Object>) m : new LinkedHashMap<>();
  }

  @SuppressWarnings("unchecked")
  public static List<Object> list(Object v) {
    Object p = v instanceof String ? parse(v) : v;
    return p instanceof List<?> l ? (List<Object>) l : new ArrayList<>();
  }

  public static List<String> strings(Object v) {
    List<String> out = new ArrayList<>();
    for (Object o : list(v)) if (o != null) out.add(String.valueOf(o));
    return out;
  }

  public static Map<String, Object> readMap(String json) {
    try {
      return M.readValue(json, new TypeReference<LinkedHashMap<String, Object>>() {});
    } catch (Exception e) {
      throw new IllegalStateException("Invalid JSON: " + e.getMessage(), e);
    }
  }

  /** Nested value by dotted path, e.g. get(cfg, "models.chat"). */
  public static Object get(Map<String, Object> m, String path) {
    Object cur = m;
    for (String k : path.split("\\.")) {
      if (!(cur instanceof Map<?, ?> mm)) return null;
      cur = mm.get(k);
    }
    return cur;
  }

  /** Deep merge: values in extra win; nested maps are merged; result is a fresh copy. */
  @SuppressWarnings("unchecked")
  public static Map<String, Object> merge(Map<String, Object> base, Map<String, Object> extra) {
    LinkedHashMap<String, Object> out = new LinkedHashMap<>();
    if (base != null) base.forEach((k, v) -> out.put(k, copy(v)));
    if (extra != null) {
      extra.forEach((k, v) -> {
        Object b = out.get(k);
        if (v instanceof Map<?, ?> vm && b instanceof Map<?, ?> bm) out.put(k, merge((Map<String, Object>) bm, (Map<String, Object>) vm));
        else out.put(k, copy(v));
      });
    }
    return out;
  }

  @SuppressWarnings("unchecked")
  private static Object copy(Object v) {
    if (v instanceof Map<?, ?> m) return merge((Map<String, Object>) m, null);
    if (v instanceof List<?> l) {
      List<Object> c = new ArrayList<>();
      for (Object o : l) c.add(copy(o));
      return c;
    }
    return v;
  }
}
