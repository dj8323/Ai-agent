// Accounts, passwords and sign-in sessions (MySQL tables: users, roles, sessions).
// - Passwords are stored only as scrypt hashes (never plain text).
// - Roles: 1 = admin (dashboard over all users), 2 = user (own agents and data only).
// - Sessions: random token in an HttpOnly cookie; only its SHA-256 is stored.
// - Self sign-up (when app_config.auth.allowSignup is true) creates a role-2 user.
import crypto from "node:crypto";
import { promisify } from "node:util";
import { query, one, exec, iso } from "./db.js";
import { appConfig } from "./config.js";

const scrypt = promisify(crypto.scrypt);
export const ROLE_ADMIN = 1;
export const ROLE_USER = 2;
export const COOKIE = "tsa_session";

// ---------- passwords ----------
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(String(password), salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}
async function verifyPassword(password, stored) {
  const [kind, saltHex, hashHex] = String(stored || "").split("$");
  if (kind !== "scrypt" || !saltHex || !hashHex) return false;
  const hash = await scrypt(String(password), Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
}
export function checkPasswordStrength(pw) {
  pw = String(pw || "");
  if (pw.length < 6) return "Password must be at least 6 characters.";
  if (pw.length > 128) return "Password is too long.";
  return null;
}

// ---------- users ----------
export const newId = () => crypto.randomUUID().slice(0, 8);
const USER_COLS = "id, username, name, email, role_id, password_hash, must_change_password, disabled, signup_source, created_at, last_login_at";

export const publicUser = (u) => u && ({
  id: u.id, username: u.username, name: u.name, email: u.email || "", role: u.role_id, disabled: !!u.disabled,
  createdAt: iso(u.created_at), lastLoginAt: iso(u.last_login_at), mustChangePassword: !!u.must_change_password,
  signupSource: u.signup_source,
});

export async function listUsers() {
  return (await query(`SELECT ${USER_COLS} FROM users WHERE deleted_at IS NULL ORDER BY created_at`)).map(publicUser);
}
export async function getUser(id) {
  return one(`SELECT ${USER_COLS} FROM users WHERE id = ? AND deleted_at IS NULL`, [id]);
}

const cleanUsername = (v) => String(v || "").trim().toLowerCase();
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,100}\.[^\s@]{2,}$/;

/**
 * Create an account. source: "admin" (temporary password, must change it), "self" (sign-up), "setup".
 */
export async function createUser({ username, name, email, password, role }, source = "admin") {
  username = cleanUsername(username);
  if (!USERNAME_RE.test(username)) throw new Error("Username: 3–32 letters, numbers, dot, dash or underscore.");
  const weak = checkPasswordStrength(password);
  if (weak) throw new Error(weak);
  email = String(email || "").trim().toLowerCase();
  if (email && !EMAIL_RE.test(email)) throw new Error("That email address doesn't look right.");
  if (await one("SELECT id FROM users WHERE username = ?", [username])) throw new Error("That username is already taken.");
  if (email && (await one("SELECT id FROM users WHERE email = ? AND deleted_at IS NULL", [email]))) throw new Error("An account with that email already exists.");
  const id = newId();
  await exec(
    `INSERT INTO users (id, username, name, email, role_id, password_hash, must_change_password, signup_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, username, String(name || username).trim().slice(0, 60) || username, email || null,
      source === "self" ? ROLE_USER : Number(role) === ROLE_ADMIN ? ROLE_ADMIN : ROLE_USER,
      await hashPassword(password), source === "self" ? 0 : 1, source],
  );
  return publicUser(await getUser(id));
}

const activeAdmins = async () => (await one("SELECT COUNT(*) AS n FROM users WHERE role_id = 1 AND disabled = 0 AND deleted_at IS NULL")).n;

export async function updateUser(id, changes, actingUserId) {
  const u = await getUser(id);
  if (!u) throw new Error("User not found.");
  const losingAdmin = (changes.role !== undefined && Number(changes.role) !== ROLE_ADMIN) || changes.disabled === true;
  if (u.role_id === ROLE_ADMIN && losingAdmin && (await activeAdmins()) <= 1) throw new Error("There must always be at least one active admin.");
  if (id === actingUserId && losingAdmin) throw new Error("You can't remove your own admin access.");
  const set = {};
  if (changes.name !== undefined) set.name = String(changes.name).trim().slice(0, 60) || u.username;
  if (changes.role !== undefined) set.role_id = Number(changes.role) === ROLE_ADMIN ? ROLE_ADMIN : ROLE_USER;
  if (changes.disabled !== undefined) set.disabled = changes.disabled ? 1 : 0;
  if (changes.password !== undefined) {
    const weak = checkPasswordStrength(changes.password);
    if (weak) throw new Error(weak);
    set.password_hash = await hashPassword(changes.password);
    set.must_change_password = id !== actingUserId ? 1 : 0; // reset by an admin → user should pick their own
  }
  if (Object.keys(set).length) await exec("UPDATE users SET ? WHERE id = ?", [set, id]);
  // Disabled, or password reset by an admin → sign that user out everywhere.
  if (set.disabled || (changes.password !== undefined && id !== actingUserId)) await revokeSessions(id);
  return publicUser(await getUser(id));
}

/** Soft delete: the account can't sign in and is hidden, but its agents, calls and recordings are kept. */
export async function deleteUser(id, actingUserId) {
  if (id === actingUserId) throw new Error("You can't delete your own account.");
  const u = await getUser(id);
  if (!u) throw new Error("User not found.");
  if (u.role_id === ROLE_ADMIN && (await one("SELECT COUNT(*) AS n FROM users WHERE role_id = 1 AND deleted_at IS NULL")).n <= 1) {
    throw new Error("You can't delete the last admin.");
  }
  // Free the username (and email) for someone new; the old name stays readable in the row.
  await exec("UPDATE users SET deleted_at = UTC_TIMESTAMP(3), disabled = 1, username = ?, email = NULL WHERE id = ?", [`${u.username}~deleted-${id}`.slice(0, 64), id]);
  await revokeSessions(id);
  return publicUser(u);
}

export async function changeOwnPassword(id, current, next) {
  const u = await getUser(id);
  if (!u || !(await verifyPassword(current, u.password_hash))) throw new Error("Your current password is wrong.");
  const weak = checkPasswordStrength(next);
  if (weak) throw new Error(weak);
  if (current === next) throw new Error("Choose a password different from the current one.");
  await exec("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?", [await hashPassword(next), id]);
}

// ---------- sessions ----------
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");

async function revokeSessions(userId) {
  await exec("DELETE FROM sessions WHERE user_id = ?", [userId]);
}

// Simple brute-force protection: 5 wrong passwords per username+IP → wait 5 minutes.
const attempts = new Map();
function tooMany(key) {
  const a = attempts.get(key);
  return a && a.count >= 5 && Date.now() - a.first < 5 * 60 * 1000;
}
function noteFailure(key) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > 5 * 60 * 1000) attempts.set(key, { count: 1, first: Date.now() });
  else a.count++;
}

/** Create a session for a user → { token, maxAge }. */
export async function startSession(user, remember, ip, userAgent) {
  const token = crypto.randomBytes(32).toString("base64url");
  const { auth } = await appConfig(); // app_config.auth: sessionHours (default 12), rememberDays (default 30)
  const maxAge = remember ? (Number(auth.rememberDays) || 30) * 86400 : (Number(auth.sessionHours) || 12) * 3600;
  await exec("INSERT INTO sessions (token_hash, user_id, ip, user_agent, expires_at) VALUES (?, ?, ?, ?, ?)",
    [sha(token), user.id, String(ip || "").slice(0, 64), String(userAgent || "").slice(0, 255), new Date(Date.now() + maxAge * 1000)]);
  await exec("UPDATE users SET last_login_at = UTC_TIMESTAMP(3) WHERE id = ?", [user.id]);
  await exec("DELETE FROM sessions WHERE expires_at < UTC_TIMESTAMP(3)"); // tidy up old ones
  return { token, maxAge: remember ? maxAge : null };
}

export async function login(username, password, remember, ip, userAgent) {
  username = cleanUsername(username);
  const key = `${username}|${ip}`;
  if (tooMany(key)) throw Object.assign(new Error("Too many attempts. Wait 5 minutes and try again."), { status: 429 });
  const u = await one(`SELECT ${USER_COLS} FROM users WHERE username = ? AND deleted_at IS NULL`, [username]);
  // Always run a hash check, so a wrong username takes as long as a wrong password.
  const ok = await verifyPassword(password, u?.password_hash || "scrypt$00$00");
  if (!u || !ok) {
    noteFailure(key);
    throw Object.assign(new Error("Wrong username or password."), { status: 401 });
  }
  if (u.disabled) throw Object.assign(new Error("This account is disabled. Ask your admin."), { status: 403 });
  attempts.delete(key);
  const { token, maxAge } = await startSession(u, remember, ip, userAgent);
  return { token, maxAge, user: publicUser(await getUser(u.id)) };
}

export async function logout(token) {
  await exec("DELETE FROM sessions WHERE token_hash = ?", [sha(token)]);
}

export function readCookie(req, name = COOKIE) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

/** Returns { user, token } for a valid session cookie, or null. */
export async function sessionFrom(req) {
  const token = readCookie(req);
  if (!token) return null;
  const u = await one(
    `SELECT u.${USER_COLS.split(", ").join(", u.")} FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP(3) AND u.disabled = 0 AND u.deleted_at IS NULL`,
    [sha(token)],
  );
  return u ? { user: publicUser(u), token } : null;
}

export function sessionCookie(token, maxAge) {
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${maxAge ? `; Max-Age=${maxAge}` : ""}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

/** First start with an empty users table: create admin / admin@123 (must change it). */
export async function ensureAdmin() {
  if ((await one("SELECT COUNT(*) AS n FROM users")).n) return null;
  const id = newId();
  await exec(
    `INSERT INTO users (id, username, name, role_id, password_hash, must_change_password, signup_source) VALUES (?, 'admin', 'Admin', 1, ?, 1, 'setup')`,
    [id, await hashPassword("admin@123")],
  );
  return publicUser(await getUser(id));
}
