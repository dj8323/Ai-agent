// TelemuneSmartAi frontend app: serves the pages in public/ and forwards every /api/* request to the
// Spring Boot backend (BACKEND_URL, default http://127.0.0.1:8324). No dependencies, no build step.
// Same origin for the browser, so the sign-in cookie and live call streaming (SSE) just work.
//
// Pages: signed-out visits to /, /index.html, /admin.html go to /login.html; /admin.html is for admins only.
//
// HTTPS (so the microphone works from other computers; browsers allow it only on https or localhost):
// when certs/server.crt + certs/server.key exist (made by scripts/make-cert.sh, which runScript.sh runs), the same
// app is also served on https://<this machine's IP>:HTTPS_PORT (8443). Visits to http://<IP>:8323 are sent there;
// http://localhost:8323 keeps working as before.
import http from "node:http";
import https from "node:https";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, "public");
const ROOT = path.dirname(here); // project folder (config.json lives there)

function configPort() {
  try {
    return Number(JSON.parse(fsSync.readFileSync(path.join(ROOT, "config.json"), "utf8")).server?.port) || 0;
  } catch {
    return 0;
  }
}
const PORT = Number(process.env.PORT) || configPort() || 8323;
function configHttpsPort() {
  try {
    return Number(JSON.parse(fsSync.readFileSync(path.join(ROOT, "config.json"), "utf8")).server?.httpsPort) || 0;
  } catch {
    return 0;
  }
}
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || configHttpsPort() || 8443;
const CERT = process.env.HTTPS_CERT || path.join(ROOT, "certs", "server.crt");
const KEY = process.env.HTTPS_KEY || path.join(ROOT, "certs", "server.key");
const HTTPS_ON = process.env.HTTPS !== "off" && fsSync.existsSync(CERT) && fsSync.existsSync(KEY);
const BACKEND = new URL(process.env.BACKEND_URL || `http://127.0.0.1:${process.env.BACKEND_PORT || 8324}`);

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
      res.writeHead(r.statusCode || 502, r.headers);
      r.pipe(res);
    },
  );
  up.on("error", () => {
    if (!res.headersSent) json(res, 502, { error: "The backend isn't running. Start it with ./runScript.sh" });
    else res.end();
  });
  res.on("close", () => up.destroy()); // caller hung up mid-stream → stop the backend work too
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

async function handle(req, res) {
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
          <h2>The backend isn't running yet</h2><p>Start everything with <code>./runScript.sh</code>, then reload this page.</p>`);
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
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: "Server error" });
    else res.end();
  }
}

http.createServer(handle).listen(PORT, () => {
  console.log(`TelemuneSmartAi frontend at http://localhost:${PORT}  (API → ${BACKEND.origin})`);
});
if (HTTPS_ON) {
  https.createServer({ cert: fsSync.readFileSync(CERT), key: fsSync.readFileSync(KEY) }, handle).listen(HTTPS_PORT, () => {
    console.log(`TelemuneSmartAi frontend at https://<this machine's IP>:${HTTPS_PORT}  (for other computers; microphone allowed)`);
  });
}
