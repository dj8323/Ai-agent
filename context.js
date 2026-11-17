// Per-request context: who is signed in, whose data the request works on, and which of their agents is active.
// Data modules (agents, playbooks, calls, calendar, config) read it from here, so a request only ever touches the
// signed-in user's rows (the admin can read another user's data, GET only, with ?as=<userId>).
import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "data");
export const requestContext = new AsyncLocalStorage();
const store = () => requestContext.getStore() || {};

/** The user whose data this request reads/writes. */
export function currentDataUserId() {
  const id = store().dataUserId || null;
  if (!id) throw new Error("No signed-in user for this request.");
  return id;
}

/** The agent this request is for (row from the agents table), or null. */
export const currentAgent = () => store().agent || null;

/** Folder for files that stay on disk (call recordings): data/users/<userId>/. */
export function userDataDir(id = currentDataUserId()) {
  if (!id || !/^[a-z0-9-]+$/i.test(id)) throw new Error("No signed-in user for this request.");
  return path.join(DATA_DIR, "users", id);
}

/** Run fn with another user's data (and optionally agent) selected. */
export function asUser(userId, fn, agent = null) {
  return requestContext.run({ ...store(), dataUserId: userId, agent }, fn);
}
