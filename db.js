// MySQL connection (database `ai-agent`, settings in .env: MYSQL_HOST/PORT/USER/PASSWORD/DATABASE).
// On start: creates the database and tables (db/schema.sql, all IF NOT EXISTS), so a fresh MySQL just works.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
export const DB_NAME = env.MYSQL_DATABASE || "ai-agent";
const base = {
  host: env.MYSQL_HOST || "localhost",
  port: Number(env.MYSQL_PORT) || 3306,
  user: env.MYSQL_USER || "root",
  password: env.MYSQL_PASSWORD || "",
  timezone: "Z", // every DATETIME is UTC
  charset: "utf8mb4",
};

let pool = null;

/** Create the database + tables if missing, then open the connection pool. */
export async function initDb() {
  const sql = (await fs.readFile(path.join(here, "db", "schema.sql"), "utf8"))
    .replaceAll("`ai-agent`", "`" + DB_NAME.replace(/`/g, "") + "`");
  const conn = await mysql.createConnection({ ...base, multipleStatements: true });
  try {
    await conn.query(sql);
  } finally {
    await conn.end();
  }
  pool = mysql.createPool({ ...base, database: DB_NAME, connectionLimit: 10, waitForConnections: true });
  // DEFAULT CURRENT_TIMESTAMP columns must be UTC too, like the dates the app writes.
  pool.pool.on("connection", (c) => c.query("SET time_zone = '+00:00'"));
  return pool;
}

function db() {
  if (!pool) throw new Error("Database not connected yet.");
  return pool;
}

/** Rows of a SELECT. */
export async function query(sql, params = []) {
  const [rows] = await db().query(sql, params);
  return rows;
}
/** First row or null. */
export async function one(sql, params = []) {
  return (await query(sql, params))[0] || null;
}
/** INSERT / UPDATE / DELETE → { affectedRows, insertId }. */
export async function exec(sql, params = []) {
  const [res] = await db().query(sql, params);
  return res;
}
/** Run fn(conn) inside a transaction. */
export async function tx(fn) {
  const conn = await db().getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn({
      query: async (s, p = []) => (await conn.query(s, p))[0],
      exec: async (s, p = []) => (await conn.query(s, p))[0],
    });
    await conn.commit();
    return out;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export const iso = (d) => (d ? new Date(d).toISOString() : null);
export const toDate = (v) => {
  const d = v ? new Date(v) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
};
export const asJson = (v) => (typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v);
