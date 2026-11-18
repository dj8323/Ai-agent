package com.telemune.smartai.service;

import com.telemune.smartai.db.Db;
import com.telemune.smartai.util.J;
import com.telemune.smartai.web.ApiException;
import org.bouncycastle.crypto.generators.SCrypt;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Accounts, passwords and sign-in sessions (tables users, roles, sessions, login_attempts).
 * - Passwords: scrypt (N=16384, r=8, p=1, 64 bytes), stored as scrypt$salt$hash, the same format the old Node server wrote.
 * - Sessions: random token in an HttpOnly cookie; only its SHA-256 is stored.
 * - Every sign-in attempt is written to login_attempts; 5 failures per username+IP in 5 minutes lock it for a while.
 */
@Service
public class AuthService {
  public static final int ROLE_ADMIN = 1;
  public static final int ROLE_USER = 2;
  public static final String COOKIE = "tsa_session";
  private static final String USER_COLS = "id, username, name, email, role_id, password_hash, must_change_password, disabled, signup_source, created_at, last_login_at";
  private static final Pattern USERNAME_RE = Pattern.compile("^[a-z0-9._-]{3,32}$");
  private static final Pattern EMAIL_RE = Pattern.compile("^[^\\s@]{1,64}@[^\\s@]{1,100}\\.[^\\s@]{2,}$");
  private static final SecureRandom RNG = new SecureRandom();

  private final Db db;
  private final AppConfigService config;

  public AuthService(Db db, AppConfigService config) {
    this.db = db;
    this.config = config;
  }

  // ---------- passwords ----------
  private static byte[] scrypt(String password, byte[] salt) {
    return SCrypt.generate(password.getBytes(StandardCharsets.UTF_8), salt, 16384, 8, 1, 64);
  }

  public static String hashPassword(String password) {
    byte[] salt = new byte[16];
    RNG.nextBytes(salt);
    HexFormat hex = HexFormat.of();
    return "scrypt$" + hex.formatHex(salt) + "$" + hex.formatHex(scrypt(password, salt));
  }

  static boolean verifyPassword(String password, String stored) {
    String[] p = String.valueOf(stored).split("\\$");
    if (p.length != 3 || !"scrypt".equals(p[0])) {
      scrypt(String.valueOf(password), new byte[16]); // same time as a real check
      return false;
    }
    try {
      byte[] expected = HexFormat.of().parseHex(p[2]);
      return MessageDigest.isEqual(expected, scrypt(String.valueOf(password), HexFormat.of().parseHex(p[1])));
    } catch (IllegalArgumentException e) {
      return false;
    }
  }

  public static String checkPasswordStrength(Object pw) {
    String s = pw == null ? "" : String.valueOf(pw);
    if (s.length() < 6) return "Password must be at least 6 characters.";
    if (s.length() > 128) return "Password is too long.";
    return null;
  }

  // ---------- users ----------
  public static Map<String, Object> publicUser(Map<String, Object> u) {
    if (u == null) return null;
    return J.map("id", u.get("id"), "username", u.get("username"), "name", u.get("name"), "email", u.get("email") == null ? "" : u.get("email"),
        "role", J.num(u.get("role_id")), "disabled", J.bool(u.get("disabled")), "createdAt", J.iso(u.get("created_at")),
        "lastLoginAt", J.iso(u.get("last_login_at")), "mustChangePassword", J.bool(u.get("must_change_password")),
        "signupSource", u.get("signup_source"));
  }

  public List<Map<String, Object>> listUsers() {
    return db.query("SELECT " + USER_COLS + " FROM users WHERE deleted_at IS NULL ORDER BY created_at").stream().map(AuthService::publicUser).toList();
  }

  public Map<String, Object> getUser(String id) {
    return db.one("SELECT " + USER_COLS + " FROM users WHERE id = ? AND deleted_at IS NULL", id);
  }

  /** Create an account. source: "admin" (temporary password, must change it), "self" (sign-up), "setup". */
  public Map<String, Object> createUser(Map<String, Object> in, String source) {
    String username = J.str(in.get("username")).toLowerCase();
    if (!USERNAME_RE.matcher(username).matches()) throw ApiException.bad("Username: 3–32 letters, numbers, dot, dash or underscore.");
    String weak = checkPasswordStrength(in.get("password"));
    if (weak != null) throw ApiException.bad(weak);
    String email = J.str(in.get("email")).toLowerCase();
    if (!email.isEmpty() && !EMAIL_RE.matcher(email).matches()) throw ApiException.bad("That email address doesn't look right.");
    if (db.one("SELECT id FROM users WHERE username = ?", username) != null) throw ApiException.bad("That username is already taken.");
    if (!email.isEmpty() && db.one("SELECT id FROM users WHERE email = ? AND deleted_at IS NULL", email) != null) {
      throw ApiException.bad("An account with that email already exists.");
    }
    String id = J.newId();
    String name = J.str(in.get("name"), 60);
    int role = "self".equals(source) ? ROLE_USER : J.num(in.get("role")) == ROLE_ADMIN ? ROLE_ADMIN : ROLE_USER;
    db.exec("INSERT INTO users (id, username, name, email, role_id, password_hash, must_change_password, signup_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        id, username, name.isEmpty() ? username : name, email.isEmpty() ? null : email, role,
        hashPassword(String.valueOf(in.get("password"))), "self".equals(source) ? 0 : 1, source);
    return publicUser(getUser(id));
  }

  private long activeAdmins() {
    return db.count("SELECT COUNT(*) FROM users WHERE role_id = 1 AND disabled = 0 AND deleted_at IS NULL");
  }

  public Map<String, Object> updateUser(String id, Map<String, Object> ch, String actingUserId) {
    Map<String, Object> u = getUser(id);
    if (u == null) throw ApiException.notFound("User not found.");
    boolean losingAdmin = (ch.containsKey("role") && J.num(ch.get("role")) != ROLE_ADMIN) || Boolean.TRUE.equals(ch.get("disabled"));
    if (J.num(u.get("role_id")) == ROLE_ADMIN && losingAdmin && activeAdmins() <= 1) throw ApiException.bad("There must always be at least one active admin.");
    if (id.equals(actingUserId) && losingAdmin) throw ApiException.bad("You can't remove your own admin access.");
    if (ch.containsKey("name")) {
      String n = J.str(ch.get("name"), 60);
      db.exec("UPDATE users SET name = ? WHERE id = ?", n.isEmpty() ? u.get("username") : n, id);
    }
    if (ch.containsKey("role")) db.exec("UPDATE users SET role_id = ? WHERE id = ?", J.num(ch.get("role")) == ROLE_ADMIN ? ROLE_ADMIN : ROLE_USER, id);
    if (ch.containsKey("disabled")) db.exec("UPDATE users SET disabled = ? WHERE id = ?", J.bool(ch.get("disabled")) ? 1 : 0, id);
    boolean reset = false;
    if (ch.containsKey("password")) {
      String weak = checkPasswordStrength(ch.get("password"));
      if (weak != null) throw ApiException.bad(weak);
      reset = !id.equals(actingUserId);
      db.exec("UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?", hashPassword(String.valueOf(ch.get("password"))), reset ? 1 : 0, id);
    }
    // Disabled, or password reset by an admin → sign that user out everywhere.
    if (J.bool(ch.get("disabled")) || reset) revokeSessions(id);
    return publicUser(getUser(id));
  }

  /** Soft delete: can't sign in and is hidden, but agents, calls and recordings stay. */
  public Map<String, Object> deleteUser(String id, String actingUserId) {
    if (id.equals(actingUserId)) throw ApiException.bad("You can't delete your own account.");
    Map<String, Object> u = getUser(id);
    if (u == null) throw ApiException.notFound("User not found.");
    if (J.num(u.get("role_id")) == ROLE_ADMIN && db.count("SELECT COUNT(*) FROM users WHERE role_id = 1 AND deleted_at IS NULL") <= 1) {
      throw ApiException.bad("You can't delete the last admin.");
    }
    String freed = (u.get("username") + "~deleted-" + id);
    db.exec("UPDATE users SET deleted_at = UTC_TIMESTAMP(3), disabled = 1, username = ?, email = NULL WHERE id = ?", freed.length() > 64 ? freed.substring(0, 64) : freed, id);
    revokeSessions(id);
    return publicUser(u);
  }

  public void changeOwnPassword(String id, Object current, Object next) {
    Map<String, Object> u = getUser(id);
    if (u == null || !verifyPassword(String.valueOf(current), (String) u.get("password_hash"))) throw ApiException.bad("Your current password is wrong.");
    String weak = checkPasswordStrength(next);
    if (weak != null) throw ApiException.bad(weak);
    if (String.valueOf(current).equals(String.valueOf(next))) throw ApiException.bad("Choose a password different from the current one.");
    db.exec("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?", hashPassword(String.valueOf(next)), id);
  }

  // ---------- sessions ----------
  static String sha(String t) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(t.getBytes(StandardCharsets.UTF_8)));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  private void revokeSessions(String userId) {
    db.exec("DELETE FROM sessions WHERE user_id = ?", userId);
  }

  public record Session(String token, Long maxAge, Map<String, Object> user) {}

  /** Create a session for a user. maxAge is null for a browser-session cookie. */
  public Session startSession(Map<String, Object> user, boolean remember, String ip, String userAgent) {
    byte[] raw = new byte[32];
    RNG.nextBytes(raw);
    String token = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
    Map<String, Object> auth = config.section(config.app(), "auth");
    long hours = J.num(auth.get("sessionHours")) > 0 ? J.num(auth.get("sessionHours")) : 12;
    long days = J.num(auth.get("rememberDays")) > 0 ? J.num(auth.get("rememberDays")) : 30;
    long maxAge = remember ? days * 86400 : hours * 3600;
    db.exec("INSERT INTO sessions (token_hash, user_id, ip, user_agent, expires_at) VALUES (?, ?, ?, ?, ?)",
        sha(token), user.get("id"), J.str(ip, 64), J.str(userAgent, 255), J.utc(Instant.now().plusSeconds(maxAge)));
    db.exec("UPDATE users SET last_login_at = UTC_TIMESTAMP(3) WHERE id = ?", user.get("id"));
    db.exec("DELETE FROM sessions WHERE expires_at < UTC_TIMESTAMP(3)");
    return new Session(token, remember ? maxAge : null, publicUser(getUser((String) user.get("id"))));
  }

  private void noteAttempt(String username, String userId, String ip, String ua, boolean ok, String reason) {
    db.exec("INSERT INTO login_attempts (username, user_id, ip, user_agent, success, reason) VALUES (?, ?, ?, ?, ?, ?)",
        J.str(username, 64), userId, J.str(ip, 64), J.str(ua, 255), ok ? 1 : 0, J.str(reason, 80));
  }

  private boolean tooMany(String username, String ip) {
    return db.count("SELECT COUNT(*) FROM login_attempts a WHERE a.username = ? AND a.ip = ? AND a.success = 0 "
        + "AND a.created_at > UTC_TIMESTAMP(3) - INTERVAL 5 MINUTE "
        + "AND a.created_at > COALESCE((SELECT MAX(b.created_at) FROM login_attempts b WHERE b.username = ? AND b.ip = ? AND b.success = 1), '1970-01-01')",
        username, ip, username, ip) >= 5;
  }

  public Session login(Object usernameIn, Object password, boolean remember, String ip, String ua) {
    String username = J.str(usernameIn).toLowerCase();
    if (tooMany(username, ip)) {
      noteAttempt(username, null, ip, ua, false, "locked");
      throw new ApiException(429, "Too many attempts. Wait 5 minutes and try again.");
    }
    Map<String, Object> u = db.one("SELECT " + USER_COLS + " FROM users WHERE username = ? AND deleted_at IS NULL", username);
    // Always run a hash check, so a wrong username takes as long as a wrong password.
    boolean ok = verifyPassword(String.valueOf(password), u == null ? "scrypt$00$00" : (String) u.get("password_hash"));
    if (u == null || !ok) {
      noteAttempt(username, u == null ? null : (String) u.get("id"), ip, ua, false, u == null ? "unknown user" : "wrong password");
      throw new ApiException(401, "Wrong username or password.");
    }
    if (J.bool(u.get("disabled"))) {
      noteAttempt(username, (String) u.get("id"), ip, ua, false, "disabled");
      throw new ApiException(403, "This account is disabled. Ask your admin.");
    }
    noteAttempt(username, (String) u.get("id"), ip, ua, true, remember ? "ok (remember me)" : "ok");
    return startSession(u, remember, ip, ua);
  }

  public void logout(String token) {
    if (token != null) db.exec("DELETE FROM sessions WHERE token_hash = ?", sha(token));
  }

  /** The signed-in user (public shape) for a session token, or null. */
  public Map<String, Object> userForToken(String token) {
    if (token == null || token.isEmpty()) return null;
    Map<String, Object> u = db.one("SELECT u.id, u.username, u.name, u.email, u.role_id, u.must_change_password, u.disabled, u.signup_source, u.created_at, u.last_login_at "
        + "FROM sessions s JOIN users u ON u.id = s.user_id "
        + "WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP(3) AND u.disabled = 0 AND u.deleted_at IS NULL", sha(token));
    return publicUser(u);
  }

  public static String sessionCookie(String token, Long maxAge) {
    return COOKIE + "=" + token + "; Path=/; HttpOnly; SameSite=Lax" + (maxAge != null ? "; Max-Age=" + maxAge : "");
  }

  public static String clearCookie() {
    return COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
  }

  /** Sign-ups from one IP in the last hour (from the activity log). */
  public long recentSignups(String ip) {
    return db.count("SELECT COUNT(*) FROM activity_logs WHERE action = 'auth.signup' AND ip = ? AND created_at > UTC_TIMESTAMP(3) - INTERVAL 1 HOUR", ip);
  }

  /** First start with an empty users table: admin / admin@123 (must change it). Returns the new user or null. */
  public Map<String, Object> ensureAdmin() {
    if (db.count("SELECT COUNT(*) FROM users") > 0) return null;
    String id = J.newId();
    db.exec("INSERT INTO users (id, username, name, role_id, password_hash, must_change_password, signup_source) VALUES (?, 'admin', 'Admin', 1, ?, 1, 'setup')",
        id, hashPassword("admin@123"));
    return publicUser(getUser(id));
  }
}
