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
  private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(AuthService.class);
  public static final int ROLE_SUPER = 0;
  public static final int ROLE_ADMIN = 1;
  public static final int ROLE_USER = 2;
  public static final String COOKIE = "tsa_session";
  private static final String USER_COLS = "id, username, name, email, role_id, password_hash, must_change_password, disabled, signup_source, created_by, permissions, created_at, last_login_at";
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
        "signupSource", u.get("signup_source"), "createdBy", u.get("created_by"), "permissions", J.parse(u.get("permissions")));
  }

  // ---------- permissions ----------
  /** Admin dashboard sections an admin can be given (the SuperAdmin always has all, plus Admins and Server). */
  public static final List<String> ADMIN_SECTIONS = List.of("overview", "users", "agents", "usage", "templates", "settings", "logins", "activity");
  /** Main-app features an admin can show or hide for users (the SuperAdmin decides them for admins). */
  public static final List<String> APP_FEATURES = List.of("talk.call", "talk.chat", "talk.voice", "talk.whatsapp",
      "tab.profile", "tab.voice", "tab.availability", "tab.tools", "tool.calendar", "tool.emergency", "tool.playbook", "tool.summaries",
      "history", "agents.create", "agents.delete");

  public static boolean isStaff(Object role) { return role != null && J.num(role) <= ROLE_ADMIN; }
  /** The role of a public user map; anything missing counts as a plain user (never as the SuperAdmin). */
  public static long roleOf(Map<String, Object> u) { return u == null || u.get("role") == null ? ROLE_USER : J.num(u.get("role")); }

  /** What this account may see: {admin:[sections], app:{feature:bool}}. Missing = allowed; the SuperAdmin has everything. */
  public static Map<String, Object> effective(Map<String, Object> user) {
    Map<String, Object> app = new java.util.LinkedHashMap<>();
    boolean superAdmin = roleOf(user) == ROLE_SUPER;
    Map<String, Object> p = user == null || superAdmin ? Map.of() : J.obj(user.get("permissions"));
    Map<String, Object> given = J.obj(p.get("app"));
    for (String f : APP_FEATURES) app.put(f, !given.containsKey(f) || J.bool(given.get(f)));
    List<String> sections = superAdmin || !p.containsKey("admin") ? ADMIN_SECTIONS
        : J.list(p.get("admin")).stream().map(String::valueOf).filter(ADMIN_SECTIONS::contains).toList();
    return J.map("admin", user != null && isStaff(user.get("role")) ? sections : List.of(), "app", app);
  }

  public static boolean can(Map<String, Object> user, String feature) {
    return J.bool(J.obj(effective(user).get("app")).get(feature));
  }

  public List<Map<String, Object>> listUsers() {
    return db.query("SELECT " + USER_COLS + " FROM users WHERE deleted_at IS NULL ORDER BY created_at").stream().map(AuthService::publicUser).toList();
  }

  public Map<String, Object> getUser(String id) {
    return db.one("SELECT " + USER_COLS + " FROM users WHERE id = ? AND deleted_at IS NULL", id);
  }

  /** Create an account. source: "admin" (temporary password, must change it), "self" (sign-up), "setup". */
  public Map<String, Object> createUser(Map<String, Object> in, String source) {
    return createUser(in, source, null);
  }

  /** creator = the signed-in admin (public shape) or null. Only the SuperAdmin can create admins. */
  public Map<String, Object> createUser(Map<String, Object> in, String source, Map<String, Object> creator) {
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
    boolean bySuper = roleOf(creator) == ROLE_SUPER;
    if (!"self".equals(source) && J.num(in.get("role")) == ROLE_ADMIN && !bySuper) throw ApiException.forbidden("Only the SuperAdmin can create admins.");
    int role = "self".equals(source) ? ROLE_USER : J.num(in.get("role")) == ROLE_ADMIN ? ROLE_ADMIN : ROLE_USER;
    db.exec("INSERT INTO users (id, username, name, email, role_id, password_hash, must_change_password, signup_source, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        id, username, name.isEmpty() ? username : name, email.isEmpty() ? null : email, role,
        hashPassword(String.valueOf(in.get("password"))), "self".equals(source) ? 0 : 1, source, creator == null ? null : creator.get("id"));
    if (in.get("permissions") instanceof Map<?, ?>) setPermissions(id, J.obj(in.get("permissions")), creator);
    return publicUser(getUser(id));
  }

  private long activeAdmins() {
    return db.count("SELECT COUNT(*) FROM users WHERE role_id IN (0, 1) AND disabled = 0 AND deleted_at IS NULL");
  }

  public Map<String, Object> updateUser(String id, Map<String, Object> ch, String actingUserId) {
    return updateUser(id, ch, publicUser(getUser(actingUserId)));
  }

  public Map<String, Object> updateUser(String id, Map<String, Object> ch, Map<String, Object> actor) {
    String actingUserId = actor == null ? "" : (String) actor.get("id");
    boolean bySuper = roleOf(actor) == ROLE_SUPER;
    Map<String, Object> u = getUser(id);
    if (u == null) throw ApiException.notFound("User not found.");
    long targetRole = J.num(u.get("role_id"));
    // Admins manage users (and their own name/email/password); only the SuperAdmin manages admins. Nobody changes the SuperAdmin here.
    if (targetRole == ROLE_SUPER && !id.equals(actingUserId)) throw ApiException.forbidden("The SuperAdmin can only be changed by itself.");
    if (targetRole == ROLE_ADMIN && !bySuper && !id.equals(actingUserId)) throw ApiException.forbidden("Only the SuperAdmin can change admins.");
    if (ch.containsKey("role") && !bySuper) throw ApiException.forbidden("Only the SuperAdmin can change roles.");
    if (ch.containsKey("role") && (targetRole == ROLE_SUPER || J.num(ch.get("role")) == ROLE_SUPER)) throw ApiException.bad("The SuperAdmin role is set on the server only.");
    if (ch.get("permissions") instanceof Map<?, ?>) {
      if (id.equals(actingUserId) && !bySuper) throw ApiException.forbidden("You can't change your own access.");
      setPermissions(id, J.obj(ch.get("permissions")), actor);
    }
    boolean losingAdmin = (ch.containsKey("role") && J.num(ch.get("role")) != ROLE_ADMIN) || Boolean.TRUE.equals(ch.get("disabled"));
    if (J.num(u.get("role_id")) == ROLE_ADMIN && losingAdmin && activeAdmins() <= 1) throw ApiException.bad("There must always be at least one active admin.");
    if (id.equals(actingUserId) && losingAdmin) throw ApiException.bad("You can't remove your own admin access.");
    if (ch.containsKey("name")) {
      String n = J.str(ch.get("name"), 60);
      db.exec("UPDATE users SET name = ? WHERE id = ?", n.isEmpty() ? u.get("username") : n, id);
    }
    if (ch.containsKey("username")) { // admins can rename the sign-in name (same rules as sign-up)
      String un = J.str(ch.get("username"), 64).trim().toLowerCase();
      if (!un.equals(u.get("username"))) {
        if (!USERNAME_RE.matcher(un).matches()) throw ApiException.bad("Username: 3–32 letters, numbers, dot, dash or underscore.");
        if (db.one("SELECT id FROM users WHERE username = ? AND id <> ?", un, id) != null) throw ApiException.bad("That username is already taken.");
        db.exec("UPDATE users SET username = ? WHERE id = ?", un, id);
      }
    }
    if (ch.containsKey("email")) {
      String em = J.str(ch.get("email"), 160).trim();
      if (!em.isEmpty() && !EMAIL_RE.matcher(em).matches()) throw ApiException.bad("That email address doesn't look right.");
      if (!em.isEmpty() && db.one("SELECT id FROM users WHERE email = ? AND id <> ? AND deleted_at IS NULL", em, id) != null) throw ApiException.bad("That email is already used by another account.");
      db.exec("UPDATE users SET email = ? WHERE id = ?", em.isEmpty() ? null : em, id);
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

  /**
   * Access settings. For an admin (SuperAdmin only): {admin:[sections], app:{…}}. For a user (any admin): {app:{…}}, and an
   * admin can only switch on what it has itself.
   */
  private void setPermissions(String id, Map<String, Object> in, Map<String, Object> actor) {
    Map<String, Object> u = getUser(id);
    boolean bySuper = roleOf(actor) == ROLE_SUPER;
    if (u == null || J.num(u.get("role_id")) == ROLE_SUPER) return;
    boolean targetAdmin = J.num(u.get("role_id")) == ROLE_ADMIN;
    if (targetAdmin && !bySuper) throw ApiException.forbidden("Only the SuperAdmin can set what an admin sees.");
    Map<String, Object> mine = J.obj(effective(actor).get("app"));
    Map<String, Object> app = new java.util.LinkedHashMap<>();
    Map<String, Object> want = J.obj(in.get("app"));
    for (String f : APP_FEATURES) app.put(f, (!want.containsKey(f) || J.bool(want.get(f))) && (bySuper || J.bool(mine.get(f))));
    Map<String, Object> out = J.map("app", app);
    if (targetAdmin) out.put("admin", J.list(in.get("admin")).stream().map(String::valueOf).filter(ADMIN_SECTIONS::contains).distinct().toList());
    db.exec("UPDATE users SET permissions = ? WHERE id = ?", J.json(out), id);
  }

  /** Soft delete: can't sign in and is hidden, but agents, calls and recordings stay. */
  public Map<String, Object> deleteUser(String id, String actingUserId) {
    if (id.equals(actingUserId)) throw ApiException.bad("You can't delete your own account.");
    Map<String, Object> u = getUser(id);
    if (u == null) throw ApiException.notFound("User not found.");
    if (J.num(u.get("role_id")) == ROLE_SUPER) throw ApiException.bad("The SuperAdmin can't be deleted.");
    Map<String, Object> actor = getUser(actingUserId);
    if (J.num(u.get("role_id")) == ROLE_ADMIN && (actor == null || J.num(actor.get("role_id")) != ROLE_SUPER)) throw ApiException.forbidden("Only the SuperAdmin can delete admins.");
    if (J.num(u.get("role_id")) == ROLE_ADMIN && db.count("SELECT COUNT(*) FROM users WHERE role_id IN (0, 1) AND deleted_at IS NULL") <= 1) {
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
    if (ok) log.info("Sign-in OK: {} (user {}) from {} - {}", username, userId, ip, reason);
    else log.warn("Sign-in FAILED: {} from {} - {}", username, ip, reason);
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
    log.info("Sign-out");
    if (token != null) db.exec("DELETE FROM sessions WHERE token_hash = ?", sha(token));
  }

  /** The signed-in user (public shape) for a session token, or null. */
  public Map<String, Object> userForToken(String token) {
    if (token == null || token.isEmpty()) return null;
    Map<String, Object> u = db.one("SELECT u.id, u.username, u.name, u.email, u.role_id, u.must_change_password, u.disabled, u.signup_source, u.created_by, u.permissions, u.created_at, u.last_login_at "
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

  /**
   * The SuperAdmin from the backend's .env (SUPERADMIN_USERNAME + SUPERADMIN_PASSWORD): created when that username doesn't
   * exist yet (must change the password on first sign-in), or an existing account is promoted. Returns what happened, or null.
   */
  public String ensureSuperAdmin(String username, String password) {
    if (username == null || username.isBlank()) return null;
    String un = username.trim().toLowerCase();
    if (!USERNAME_RE.matcher(un).matches()) return "SUPERADMIN_USERNAME is not a valid username";
    Map<String, Object> u = db.one("SELECT id, role_id FROM users WHERE username = ? AND deleted_at IS NULL", un);
    if (u != null) {
      if (J.num(u.get("role_id")) == ROLE_SUPER) return null;
      db.exec("UPDATE users SET role_id = 0, permissions = NULL WHERE id = ?", u.get("id"));
      return "promoted " + un + " to SuperAdmin";
    }
    String weak = checkPasswordStrength(password);
    if (weak != null) return "SUPERADMIN_PASSWORD: " + weak;
    db.exec("INSERT INTO users (id, username, name, role_id, password_hash, must_change_password, signup_source) VALUES (?, ?, 'SuperAdmin', 0, ?, 1, 'setup')",
        J.newId(), un, hashPassword(password));
    return "created SuperAdmin " + un;
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
