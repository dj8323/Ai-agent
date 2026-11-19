// voice_ai_web — the TelemuneSmartAi web app: serves the pages in public/ and forwards every /api/* request to
// voice_ai_backend (backendUrl in config.json / BACKEND_URL, default http://127.0.0.1:8324). No dependencies, no build.
// Settings: config.json (port, httpsPort, backendUrl), overridden by .env or environment variables.
// Logs: logs/web.log (every request) and logs/error.log (problems).
// Same origin for the browser, so the sign-in cookie and live call streaming (SSE) just work.
//
// Pages: signed-out visits to /, /index.html, /admin.html go to /login.html; /admin.html is for admins only.
//
// HTTPS (so the microphone works from other computers; browsers allow it only on https or localhost):
// when certs/server.crt + certs/server.key exist (made by scripts/make-cert.sh, which run.sh runs), the same
// app is also served on https://<this machine's IP>:HTTPS_PORT (8443). Visits to http://<IP>:8323 are sent there;
// http://localhost:8323 keeps working as before.
import http from "node:http";
import https from "node:https";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url)); // voice_ai_web folder
const PUBLIC_DIR = path.join(ROOT, "public");

// .env (optional) → process.env, without overriding variables that are already set
const envFile = path.join(ROOT, ".env");
if (fsSync.existsSync(envFile)) {
  for (const line of fsSync.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
let CONFIG = {};
try { CONFIG = JSON.parse(fsSync.readFileSync(path.join(ROOT, "config.json"), "utf8")); } catch {}
const PORT = Number(process.env.PORT) || Number(CONFIG.port) || 8323;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || Number(CONFIG.httpsPort) || 8443;
const inRoot = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const CERT = inRoot(process.env.HTTPS_CERT || "certs/server.crt");
const KEY = inRoot(process.env.HTTPS_KEY || "certs/server.key");
const HTTPS_ON = process.env.HTTPS !== "off" && fsSync.existsSync(CERT) && fsSync.existsSync(KEY);
const BACKEND = new URL(process.env.BACKEND_URL || CONFIG.backendUrl || "http://127.0.0.1:8324");

// ---------- logs ----------
const LOG_DIR = inRoot(process.env.LOG_DIR || "logs");
fsSync.mkdirSync(LOG_DIR, { recursive: true });
const webLog = fsSync.createWriteStream(path.join(LOG_DIR, "web.log"), { flags: "a" });
const errLog = fsSync.createWriteStream(path.join(LOG_DIR, "error.log"), { flags: "a" });
const stamp = () => new Date().toISOString().replace("T", " ").replace("Z", "Z");
function logLine(level, msg) {
  const line = `${stamp()} ${level.padEnd(5)} ${msg}\n`;
  webLog.write(line);
  if (level !== "INFO") { errLog.write(line); process.stderr.write(line); }
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".json": "application/json",
  ".webm": "audio/webm", ".mp3": "audio/mpeg", ".woff2": "font/woff2",
};
const PROTECTED = new Set(["/", "/index.html", "/admin.html"]);
const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

/** Forward one request to the backend, streaming both ways (uploads, recordings, SSE replies). */
function proxy(req, res) {
  const secure = !!req.socket.encrypted;
  const headers = { ...req.headers, "x-forwarded-for": req.socket.remoteAddress || "", "x-forwarded-proto": secure ? "https" : "http" };
  const up = http.request(
    { protocol: BACKEND.protocol, hostname: BACKEND.hostname, port: BACKEND.port, method: req.method, path: req.url, headers },
    (r) => {
      // Over https the sign-in cookie is marked Secure, so it is never sent over plain http.
      if (secure && r.headers["set-cookie"]) r.headers["set-cookie"] = r.headers["set-cookie"].map((c) => (/;\s*secure/i.test(c) ? c : c + "; Secure"));
      res.reqId = r.headers["x-request-id"];
      res.writeHead(r.statusCode || 502, r.headers);
      r.pipe(res);
    },
  );
  let callerLeft = false;
  up.on("error", (e) => {
    if (callerLeft) return; // the browser stopped the request (barge-in, hang-up): not a backend problem
    logLine("ERROR", `backend unreachable at ${BACKEND.origin}: ${e.code || e.message} (${req.method} ${req.url.split("?")[0]})`);
    if (!res.headersSent) json(res, 502, { error: "The backend isn't running. Start voice_ai_backend (./run.sh in that folder)." });
    else res.end();
  });
  res.on("close", () => { if (!res.writableFinished) callerLeft = true; up.destroy(); }); // caller hung up mid-stream → stop the backend work too
  req.pipe(up);
}

/** Who is signed in (asks the backend with the browser's cookie): user, null (signed out) or "down". */
function whoAmI(req) {
  return new Promise((resolve) => {
    const r = http.request(
      { hostname: BACKEND.hostname, port: BACKEND.port, path: "/api/me", method: "GET",
        headers: { cookie: req.headers.cookie || "", host: req.headers.host || "", "x-forwarded-for": req.socket.remoteAddress || "" } },
      (resp) => {
        let body = "";
        resp.on("data", (c) => (body += c));
        resp.on("end", () => {
          if (resp.statusCode !== 200) return resolve(null);
          try { resolve(JSON.parse(body).user || null); } catch { resolve(null); }
        });
      },
    );
    r.on("error", () => resolve("down"));
    r.setTimeout(5000, () => { r.destroy(); resolve("down"); });
    r.end();
  });
}

function redirect(res, to) {
  res.writeHead(302, { Location: to, "Cache-Control": "no-store" });
  res.end();
}

async function serveFile(res, p) {
  const file = path.normalize(path.join(PUBLIC_DIR, p === "/" ? "index.html" : decodeURIComponent(p)));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return res.writeHead(403).end();
  try {
    const content = await fs.readFile(file);
    const headers = { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" };
    if (file.endsWith(".html")) headers["Cache-Control"] = "no-store"; // pages depend on who is signed in
    res.writeHead(200, headers);
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }
}

const isLocal = (host) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host || "");

// One line per request in logs/web.log: method, path (no query: it can hold spoken text), status, time, caller IP and
// the backend's request id (the same id is in voice_ai_backend/logs/backend.log).
function logRequest(req, res) {
  const t0 = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number((process.hrtime.bigint() - t0) / 1000000n);
    const rid = res.reqId;
    const msg = `${req.socket.encrypted ? "https" : "http"} ${req.method} ${req.url.split("?")[0]} ${res.statusCode} in ${ms} ms from ${req.socket.remoteAddress || "-"}${rid ? ` [${rid}]` : ""}`;
    logLine(res.statusCode >= 500 ? "ERROR" : "INFO", msg);
  });
}

async function handle(req, res) {
  logRequest(req, res);
  try {
    const p = new URL(req.url, "http://x").pathname;
    // Opened from another computer over plain http: move to https, where the microphone is allowed.
    if (HTTPS_ON && !req.socket.encrypted && !isLocal(req.headers.host) && !p.startsWith("/api/") && (req.method === "GET" || req.method === "HEAD")) {
      const hostname = (req.headers.host || "").replace(/:\d+$/, "");
      return redirect(res, `https://${hostname}:${HTTPS_PORT}${req.url}`);
    }
    if (p.startsWith("/api/")) return proxy(req, res);
    if (req.method !== "GET" && req.method !== "HEAD") return res.writeHead(405).end();

    if (PROTECTED.has(p) || p === "/login.html") {
      const user = await whoAmI(req);
      if (user === "down") {
        res.writeHead(503, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(`<!doctype html><meta charset="utf-8"><title>Starting…</title><body style="font-family:system-ui;padding:40px">
          <h2>The backend isn't running yet</h2><p>Start voice_ai_backend (<code>./run.sh</code> in its folder), then reload this page.</p>`);
      }
      if (p === "/login.html") {
        if (user) return redirect(res, user.role === 1 ? "/admin.html" : "/");
      } else if (!user) {
        return redirect(res, "/login.html");
      } else if (p === "/admin.html" && user.role !== 1) {
        return redirect(res, "/");
      }
    }
    return serveFile(res, p);
  } catch (err) {
    logLine("ERROR", `${req.method} ${req.url.split("?")[0]} failed: ${err.stack || err}`);
    if (!res.headersSent) json(res, 500, { error: "Server error" });
    else res.end();
  }
}

http.createServer(handle).listen(PORT, () => {
  const msg = `voice_ai_web at http://localhost:${PORT}  (API → ${BACKEND.origin})`;
  logLine("INFO", msg); console.log(msg);
});
if (HTTPS_ON) {
  https.createServer({ cert: fsSync.readFileSync(CERT), key: fsSync.readFileSync(KEY) }, handle).listen(HTTPS_PORT, () => {
    const msg = `voice_ai_web at https://<this machine's IP>:${HTTPS_PORT}  (for other computers; microphone allowed)`;
    logLine("INFO", msg); console.log(msg);
  });
}
