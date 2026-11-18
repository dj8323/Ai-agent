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
    addColumn("emergency_rules", "contact_type", "VARCHAR(10) NOT NULL DEFAULT 'phone' AFTER label");
    // Emergency contacts can be an email address now: widen the old VARCHAR(20).
    Long len = jdbc.queryForObject("SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
        + "AND TABLE_NAME = 'emergency_rules' AND COLUMN_NAME = 'number'", Long.class);
    if (len != null && len < 120) jdbc.execute("ALTER TABLE emergency_rules MODIFY number VARCHAR(120) NOT NULL");
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

  private void runScript(String path) throws Exception {
    String sql = new String(new ClassPathResource(path).getInputStream().readAllBytes(), StandardCharsets.UTF_8);
    for (String st : split(sql)) {
      String head = st.stripLeading().toUpperCase();
      // The database itself comes from the JDBC URL (createDatabaseIfNotExist), so skip these two.
      if (head.startsWith("CREATE DATABASE") || head.startsWith("USE ")) continue;
      jdbc.execute(st);
    }
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

  public List<Map<String, Object>> query(String sql, Object... args) {
    return jdbc.queryForList(sql, args);
  }

  public Map<String, Object> one(String sql, Object... args) {
    List<Map<String, Object>> rows = jdbc.queryForList(sql, args);
    return rows.isEmpty() ? null : rows.get(0);
  }

  public long count(String sql, Object... args) {
    Number n = jdbc.queryForObject(sql, Number.class, args);
    return n == null ? 0 : n.longValue();
  }

  public int exec(String sql, Object... args) {
    return jdbc.update(sql, args);
  }

  public <T> T tx(Supplier<T> fn) {
    return txt.execute(status -> fn.get());
  }

  public void tx(Runnable fn) {
    txt.executeWithoutResult(status -> fn.run());
  }
}
