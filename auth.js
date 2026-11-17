// Accounts, passwords and sign-in sessions.
// - Users live in data/users.json. Passwords are stored only as scrypt hashes (never plain text).
// - Roles: 1 = admin (dashboard over all users), 2 = user (own agents and data only).
// - Sessions: random token in an HttpOnly cookie; only its SHA-256 is stored (data/sessions.json).
// - First start: creates admin / admin@123 (must change password) and moves any existing single-user data
//   (playbooks, calls, summaries, recordings, calendar, agent settings) into the admin's folder.
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { DATA_DIR, userDataDir } from "./context.js";

const scrypt = promisify(crypto.scrypt);
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
export const ROLE_ADMIN = 1;
export const ROLE_USER = 2;
export const COOKIE = "tsa_session";
const SESSION_DAYS_REMEMBER = 30;
const SESSION_HOURS_DEFAULT = 12;

// ---------- storage helpers (atomic writes) ----------
async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}
async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

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
let usersCache = null;
async function readUsers() {
  return (usersCache ??= await readJson(USERS_FILE, []));
}
async function saveUsers(list) {
  usersCache = list;
  await writeJson(USERS_FILE, list);
}
export const publicUser = (u) => u && ({
  id: u.id, username: u.username, name: u.name, role: u.role, disabled: !!u.disabled,
  createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null, mustChangePassword: !!u.mustChangePassword,
});

export async function listUsers() {
  return (await readUsers()).map(publicUser);
}
export async function getUser(id) {
  return (await readUsers()).find((u) => u.id === id) || null;
}

const cleanUsername = (v) => String(v || "").trim().toLowerCase();
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

export async function createUser({ username, name, password, role }) {
  username = cleanUsername(username);
  if (!USERNAME_RE.test(username)) throw new Error("Username: 3–32 letters, numbers, dot, dash or underscore.");
  const weak = checkPasswordStrength(password);
  if (weak) throw new Error(weak);
  const users = await readUsers();
  if (users.some((u) => u.username === username)) throw new Error("That username is already taken.");
  const user = {
    id: crypto.randomUUID().slice(0, 8),
    username,
    name: String(name || username).trim().slice(0, 60) || username,
    role: Number(role) === ROLE_ADMIN ? ROLE_ADMIN : ROLE_USER,
    passwordHash: await hashPassword(password),
    mustChangePassword: true, // the admin set a temporary password; the user picks their own after signing in
    createdAt: new Date().toISOString(),
  };
  await saveUsers([...users, user]);
  await fs.mkdir(userDataDir(user.id), { recursive: true });
  return publicUser(user);
}

export async function updateUser(id, changes, actingUserId) {
  const users = await readUsers();
  const u = users.find((x) => x.id === id);
  if (!u) throw new Error("User not found.");
  const admins = users.filter((x) => x.role === ROLE_ADMIN && !x.disabled);
  const losingAdmin = (changes.role !== undefined && Number(changes.role) !== ROLE_ADMIN) || changes.disabled === true;
  if (u.role === ROLE_ADMIN && losingAdmin && admins.length <= 1) throw new Error("There must always be at least one active admin.");
  if (id === actingUserId && losingAdmin) throw new Error("You can't remove your own admin access.");
  if (changes.name !== undefined) u.name = String(changes.name).trim().slice(0, 60) || u.username;
  if (changes.role !== undefined) u.role = Number(changes.role) === ROLE_ADMIN ? ROLE_ADMIN : ROLE_USER;
  if (changes.disabled !== undefined) u.disabled = !!changes.disabled;
  if (changes.password !== undefined) {
    const weak = checkPasswordStrength(changes.password);
    if (weak) throw new Error(weak);
    u.passwordHash = await hashPassword(changes.password);
    u.mustChangePassword = id !== actingUserId; // reset by an admin → user should pick their own
  }
  await saveUsers(users);
  // Disabled, or password reset by an admin → sign that user out everywhere.
  if (u.disabled || (changes.password !== undefined && id !== actingUserId)) await revokeSessions(id);
  return publicUser(u);
}

export async function deleteUser(id, actingUserId) {
  if (id === actingUserId) throw new Error("You can't delete your own account.");
  const users = await readUsers();
  const u = users.find((x) => x.id === id);
  if (!u) throw new Error("User not found.");
  if (u.role === ROLE_ADMIN && users.filter((x) => x.role === ROLE_ADMIN).length <= 1) throw new Error("You can't delete the last admin.");
  await saveUsers(users.filter((x) => x.id !== id));
  await revokeSessions(id);
  // Keep the data, just out of the way, in case it was deleted by mistake.
  const from = userDataDir(id);
  if (fsSync.existsSync(from)) {
    const to = path.join(DATA_DIR, "deleted-users", `${u.username}-${id}-${Date.now()}`);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to);
  }
  return true;
}

export async function changeOwnPassword(id, current, next) {
  const users = await readUsers();
  const u = users.find((x) => x.id === id);
  if (!u || !(await verifyPassword(current, u.passwordHash))) throw new Error("Your current password is wrong.");
  const weak = checkPasswordStrength(next);
  if (weak) throw new Error(weak);
  if (current === next) throw new Error("Choose a password different from the current one.");
  u.passwordHash = await hashPassword(next);
  u.mustChangePassword = false;
  await saveUsers(users);
}

// ---------- sessions ----------
let sessionsCache = null;
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
async function readSessions() {
  if (!sessionsCache) {
    sessionsCache = await readJson(SESSIONS_FILE, {});
    const now = Date.now();
    for (const [k, s] of Object.entries(sessionsCache)) if (s.expires < now) delete sessionsCache[k];
  }
  return sessionsCache;
}
const saveSessions = () => writeJson(SESSIONS_FILE, sessionsCache);

async function revokeSessions(userId) {
  const s = await readSessions();
  for (const [k, v] of Object.entries(s)) if (v.userId === userId) delete s[k];
  await saveSessions();
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

export async function login(username, password, remember, ip) {
  username = cleanUsername(username);
  const key = `${username}|${ip}`;
  if (tooMany(key)) throw Object.assign(new Error("Too many attempts. Wait 5 minutes and try again."), { status: 429 });
  const users = await readUsers();
  const u = users.find((x) => x.username === username);
  // Always run a hash check, so a wrong username takes as long as a wrong password.
  const ok = await verifyPassword(password, u?.passwordHash || "scrypt$00$00");
  if (!u || !ok) {
    noteFailure(key);
    throw Object.assign(new Error("Wrong username or password."), { status: 401 });
  }
  if (u.disabled) throw Object.assign(new Error("This account is disabled. Ask your admin."), { status: 403 });
  attempts.delete(key);
  const token = crypto.randomBytes(32).toString("base64url");
  const maxAge = remember ? SESSION_DAYS_REMEMBER * 86400 : SESSION_HOURS_DEFAULT * 3600;
  (await readSessions())[sha(token)] = { userId: u.id, expires: Date.now() + maxAge * 1000, created: Date.now() };
  await saveSessions();
  u.lastLoginAt = new Date().toISOString();
  await saveUsers(users);
  return { token, maxAge: remember ? maxAge : null, user: publicUser(u) };
}

export async function logout(token) {
  const s = await readSessions();
  delete s[sha(token)];
  await saveSessions();
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
  const s = (await readSessions())[sha(token)];
  if (!s || s.expires < Date.now()) return null;
  const u = await getUser(s.userId);
  if (!u || u.disabled) return null;
  return { user: publicUser(u), token };
}

export function sessionCookie(token, maxAge) {
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${maxAge ? `; Max-Age=${maxAge}` : ""}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

// ---------- first start: admin account + move existing data into it ----------
export async function ensureSetup(configFile) {
  const users = await readUsers();
  if (users.length) return null;
  const admin = {
    id: crypto.randomUUID().slice(0, 8),
    username: "admin",
    name: "Admin",
    role: ROLE_ADMIN,
    passwordHash: await hashPassword("admin@123"),
    mustChangePassword: true,
    createdAt: new Date().toISOString(),
  };
  await saveUsers([admin]);
  const dir = userDataDir(admin.id);
  await fs.mkdir(dir, { recursive: true });
  const moved = [];
  for (const name of ["playbooks.json", "calls.json", "calendar.json", "summaries", "recordings"]) {
    const from = path.join(DATA_DIR, name);
    if (fsSync.existsSync(from)) {
      await fs.rename(from, path.join(dir, name));
      moved.push(name);
    }
  }
  // The agent setup saved so far becomes the admin's own setup.
  try {
    const cfg = JSON.parse(await fs.readFile(configFile, "utf8"));
    const mine = {};
    for (const k of ["agent", "models", "speechToText", "calendar", "emergency"]) if (cfg[k]) mine[k] = cfg[k];
    await writeJson(path.join(dir, "settings.json"), mine);
    moved.push("agent settings");
  } catch {}
  return { admin: publicUser(admin), moved };
}
