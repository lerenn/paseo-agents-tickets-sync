import { homedir } from "node:os";
import path from "node:path";
import type { BackendId } from "../shared/backends";
import { readJson, writeJson0600 } from "./files";

export const defaultKeysPath = path.join(homedir(), ".paseo", "plugin-data", "agents-tickets-sync", "keys.json");

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/;

export interface WorkspaceKey {
  key: string;
  /** Ticket system the key belongs to. Absent in files written before backends were per connection: Linear. */
  backend?: BackendId;
  /** What the key gives access to (for Linear, the organization), learned when it was validated. */
  scope: string | null;
}

export function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (!NAME.test(trimmed)) throw new Error(`Not a valid workspace name: ${JSON.stringify(name)}`);
  return trimmed.toLowerCase();
}

/**
 * API keys, one per connection (a workspace of a ticket system). Write-only from the UI's point of view: nothing here
 * is returned to the client, which only learns which workspaces have a key. Stored mode 0600.
 */
export class KeyStore {
  constructor(private readonly file: string = defaultKeysPath) {}

  private read(): Record<string, WorkspaceKey> {
    return readJson(this.file, {});
  }

  names(backend?: BackendId): string[] {
    return Object.entries(this.read())
      .filter(([, v]) => !backend || (v.backend ?? "linear") === backend)
      .map(([name]) => name)
      .sort();
  }

  backend(name: string): BackendId | null {
    const entry = this.read()[normalizeName(name)];
    return entry ? (entry.backend ?? "linear") : null;
  }

  scope(name: string): string | null {
    return this.read()[normalizeName(name)]?.scope ?? null;
  }

  get(name: string): string | null {
    return this.read()[normalizeName(name)]?.key ?? null;
  }

  set(backend: BackendId, name: string, key: string, scope: string | null = null) {
    const clean = key.trim();
    if (!clean) throw new Error("API key is empty");
    if (/\s/.test(clean)) throw new Error("API keys cannot contain whitespace");
    const id = normalizeName(name);
    const existing = this.read()[id];
    if (existing && (existing.backend ?? "linear") !== backend) {
      throw new Error(`"${name}" is already a connection to another backend. Pick a different name or remove it first.`);
    }
    writeJson0600(this.file, { ...this.read(), [id]: { key: clean, scope, backend } });
  }

  clear(name: string) {
    const { [normalizeName(name)]: _removed, ...rest } = this.read();
    writeJson0600(this.file, rest);
  }
}
