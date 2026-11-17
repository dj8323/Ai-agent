// Per-request context: which signed-in user is making the request, and whose data it works on.
// Data modules (playbooks, calls, calendar, per-user settings) read the user from here, so every request
// only ever touches that user's folder: data/users/<userId>/.
import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "data");
export const requestContext = new AsyncLocalStorage();

/** The user whose data this request reads/writes (the admin can look at another user's data, read-only). */
export function currentDataUserId() {
  return requestContext.getStore()?.dataUserId || null;
}

export function userDataDir(id = currentDataUserId()) {
  if (!id || !/^[a-z0-9-]+$/i.test(id)) throw new Error("No signed-in user for this request.");
  return path.join(DATA_DIR, "users", id);
}

/** Run fn with another user's data selected (used by the admin dashboard to gather per-user stats). */
export function asUser(userId, fn) {
  const store = requestContext.getStore() || {};
  return requestContext.run({ ...store, dataUserId: userId }, fn);
}
