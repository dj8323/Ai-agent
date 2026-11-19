package com.telemune.smartai.db;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

/**
 * MySQL access (database ai-agent, UTC). On start it runs db/schema.sql (all IF NOT EXISTS), adds columns that older
 * databases miss, then db/seed.sql (ready-made agent types and templates, INSERT IGNORE).
 */
@Component
public class Db {
  private static final Logger log = LoggerFactory.getLogger(Db.class);
  private final JdbcTemplate jdbc;
  private final TransactionTemplate txt;

  public Db(DataSource ds, PlatformTransactionManager tm) {
    this.jdbc = new JdbcTemplate(ds);
    this.txt = new TransactionTemplate(tm);
  }

  @PostConstruct
  void init() throws Exception {
    runScript("db/schema.sql");
    migrate();
    runScript("db/seed.sql");
    log.info("MySQL ready (schema + seed applied)");
  }

  /** Columns added after the first release: added once, so old databases catch up. */
  private void migrate() {
    addColumn("agents", "template_id", "VARCHAR(40) NULL AFTER is_default");
    addColumn("agents", "owner_name", "VARCHAR(60) NOT NULL DEFAULT '' AFTER template_id");
    addColumn("agents", "organization", "VARCHAR(80) NOT NULL DEFAULT '' AFTER owner_name");
    addColumn("agents", "owner_availability", "VARCHAR(300) NOT NULL DEFAULT '' AFTER organization");
    addColumn("agents", "greeting", "VARCHAR(400) NOT NULL DEFAULT '' AFTER owner_availability");
    addColumn("agents", "availability_plan", "JSON NULL AFTER greeting");
    addColumn("agents", "meeting_minutes", "INT NULL AFTER availability_plan");
    addColumn("agents", "speech_speed", "DECIMAL(3,2) NULL AFTER meeting_minutes");
    addColumn("api_logs", "request_id", "VARCHAR(16) NULL AFTER id");
    addColumn("activity_logs", "request_id", "VARCHAR(16) NULL AFTER id");
    addIndex("api_logs", "idx_api_request", "request_id");
    addIndex("activity_logs", "idx_activity_request", "request_id");
    addColumn("emergency_rules", "contact_type", "VARCHAR(10) NOT NULL DEFAULT 'phone' AFTER label");
    // Emergency contacts can be an email address now: widen the old VARCHAR(20).
    Long len = jdbc.queryForObject("SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
        + "AND TABLE_NAME = 'emergency_rules' AND COLUMN_NAME = 'number'", Long.class);
    if (len != null && len < 120) jdbc.execute("ALTER TABLE emergency_rules MODIFY number VARCHAR(120) NOT NULL");
    // Speech providers (2026-11-19): provider per agent, summary delivery, and longer voice ids (ElevenLabs, Cartesia).
    addColumn("agents", "tts_provider", "VARCHAR(20) NULL AFTER chat_model");
    addColumn("agents", "stt_provider", "VARCHAR(20) NULL AFTER tts_model");
    addColumn("agents", "notify", "JSON NULL AFTER speech_speed");
    widen("agents", "voice", 64, "VARCHAR(64) NOT NULL DEFAULT 'marin'");
    widen("calls", "voice", 64, "VARCHAR(64) NOT NULL DEFAULT ''");
  }

  private void widen(String table, String column, int size, String definition) {
    Long len = jdbc.queryForObject("SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
        + "AND TABLE_NAME = ? AND COLUMN_NAME = ?", Long.class, table, column);
    if (len != null && len < size) {
      jdbc.execute("ALTER TABLE " + table + " MODIFY " + column + " " + definition);
      log.info("Widened {}.{} to {}", table, column, size);
    }
  }

  private void addColumn(String table, String column, String definition) {
    Long n = jdbc.queryForObject(
        "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
        Long.class, table, column);
    if (n != null && n == 0) {
      jdbc.execute("ALTER TABLE " + table + " ADD COLUMN " + column + " " + definition);
      log.info("Added column {}.{}", table, column);
    }
  }

  private void addIndex(String table, String index, String columns) {
    Long n = jdbc.queryForObject(
        "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?",
        Long.class, table, index);
    if (n != null && n == 0) {
      jdbc.execute("ALTER TABLE " + table + " ADD INDEX " + index + " (" + columns + ")");
      log.info("Added index {}.{}", table, index);
    }
  }

  private void runScript(String path) throws Exception {
    String sql = new String(new ClassPathResource(path).getInputStream().readAllBytes(), StandardCharsets.UTF_8);
    for (String st : split(sql)) {
      String head = st.stripLeading().toUpperCase();
      // The database itself comes from the JDBC URL (createDatabaseIfNotExist), so skip these two.
      if (head.startsWith("CREATE DATABASE") || head.startsWith("USE ")) continue;
      jdbc.execute(st);
    }
    log.debug("Ran {} ({} statements)", path, split(sql).size());
  }

  /** Split a SQL script on ; outside quotes, dropping -- comments. */
  static List<String> split(String sql) {
    List<String> out = new ArrayList<>();
    StringBuilder cur = new StringBuilder();
    char quote = 0;
    for (int i = 0; i < sql.length(); i++) {
      char c = sql.charAt(i);
      if (quote != 0) {
        cur.append(c);
        if (c == '\\' && i + 1 < sql.length()) cur.append(sql.charAt(++i));
        else if (c == quote) quote = 0;
        continue;
      }
      if (c == '-' && i + 1 < sql.length() && sql.charAt(i + 1) == '-') {
        while (i < sql.length() && sql.charAt(i) != '\n') i++;
        cur.append('\n');
        continue;
      }
      if (c == '\'' || c == '"' || c == '`') quote = c;
      if (c == ';') {
        if (!cur.toString().isBlank()) out.add(cur.toString().trim());
        cur.setLength(0);
        continue;
      }
      cur.append(c);
    }
    if (!cur.toString().isBlank()) out.add(cur.toString().trim());
    return out;
  }

  // ---------- helpers ----------
  // Every statement is logged to backend.log (logger "SQL", DEBUG): time, rows, the SQL and its arguments.
  // Slow ones (over SLOW_MS) are WARN and failed ones ERROR, so they also reach error.log.

  private static final Logger sqlLog = LoggerFactory.getLogger("SQL");
  private static final long SLOW_MS = 500;

  private <T> T timed(String sql, Object[] args, Supplier<T> run, java.util.function.Function<T, Object> rows) {
    long t0 = System.nanoTime();
    try {
      T out = run.get();
      long ms = (System.nanoTime() - t0) / 1_000_000;
      if (sqlLog.isDebugEnabled()) sqlLog.debug("{} ms, rows={} | {} | args={}", ms, rows.apply(out), flat(sql), args(args));
      if (ms > SLOW_MS) log.warn("Slow SQL ({} ms): {} | args={}", ms, flat(sql), args(args));
      return out;
    } catch (RuntimeException e) {
      long ms = (System.nanoTime() - t0) / 1_000_000;
      sqlLog.debug("{} ms, FAILED | {} | args={} | {}", ms, flat(sql), args(args), e.getMessage());
      log.error("SQL failed ({} ms): {} | args={} | {}", ms, flat(sql), args(args), rootMessage(e));
      throw e;
    }
  }

  private static String flat(String sql) {
    return sql.replaceAll("\\s+", " ").trim();
  }

  private static String rootMessage(Throwable e) {
    Throwable c = e;
    while (c.getCause() != null && c.getCause() != c) c = c.getCause();
    return c.getMessage();
  }

  /** Arguments for the log: secrets masked (password hashes, session token hashes), long text cut. */
  static String args(Object[] args) {
    if (args == null || args.length == 0) return "[]";
    StringBuilder sb = new StringBuilder("[");
    for (int i = 0; i < args.length; i++) {
      if (i > 0) sb.append(", ");
      Object a = args[i];
      if (a == null) sb.append("null");
      else if (a instanceof String s) {
        if (s.startsWith("scrypt$") || s.matches("[0-9a-f]{64}")) sb.append("'***'");
        else sb.append('\'').append(s.length() > 200 ? s.substring(0, 200) + "…(" + s.length() + " chars)" : s).append('\'');
      } else if (a instanceof byte[] b) sb.append("<").append(b.length).append(" bytes>");
      else sb.append(a);
    }
    return sb.append(']').toString();
  }

  public List<Map<String, Object>> query(String sql, Object... args) {
    return timed(sql, args, () -> jdbc.queryForList(sql, args), List::size);
  }

  public Map<String, Object> one(String sql, Object... args) {
    List<Map<String, Object>> rows = query(sql, args);
    return rows.isEmpty() ? null : rows.get(0);
  }

  public long count(String sql, Object... args) {
    Number n = timed(sql, args, () -> jdbc.queryForObject(sql, Number.class, args), x -> x);
    return n == null ? 0 : n.longValue();
  }

  public int exec(String sql, Object... args) {
    return timed(sql, args, () -> jdbc.update(sql, args), x -> x);
  }

  public <T> T tx(Supplier<T> fn) {
    sqlLog.debug("BEGIN transaction");
    try {
      T out = txt.execute(status -> fn.get());
      sqlLog.debug("COMMIT");
      return out;
    } catch (RuntimeException e) {
      sqlLog.debug("ROLLBACK ({})", e.getMessage());
      throw e;
    }
  }

  public void tx(Runnable fn) {
    tx(() -> {
      fn.run();
      return null;
    });
  }
}
