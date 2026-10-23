import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Atomic write, readable by the daemon's user only. */
export function writeJson0600(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

/**
 * The plugin was called agents-tickets-sync before it became tickets-dispatcher. Its keys,
 * bindings and audit move to the new data directory once, so nothing has to be entered again.
 */
export function migrateLegacyData(home: string = homedir()): boolean {
  const base = path.join(home, ".paseo", "plugin-data");
  const legacy = path.join(base, "agents-tickets-sync");
  const current = path.join(base, "tickets-dispatcher");
  if (!existsSync(legacy) || existsSync(current)) return false;
  renameSync(legacy, current);
  return true;
}
