import { homedir } from "node:os";
import path from "node:path";
import { readJson, writeJson0600 } from "./files";

export const defaultKeysPath = path.join(homedir(), ".paseo", "plugin-data", "agents-tickets-sync", "keys.json");

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/;

export interface WorkspaceKey {
  key: string;
  /** Linear organization the key belongs to, learned when it was validated. */
  scope: string | null;
}

export function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (!NAME.test(trimmed)) throw new Error(`Not a valid workspace name: ${JSON.stringify(name)}`);
  return trimmed.toLowerCase();
}

/**
 * Linear API keys, one per Linear workspace. Write-only from the UI's point of view: nothing here
 * is returned to the client, which only learns which workspaces have a key. Stored mode 0600.
 */
export class KeyStore {
  constructor(private readonly file: string = defaultKeysPath) {}

  private read(): Record<string, WorkspaceKey> {
    return readJson(this.file, {});
  }

  names(): string[] {
    return Object.keys(this.read()).sort();
  }

  scope(name: string): string | null {
    return this.read()[normalizeName(name)]?.scope ?? null;
  }

  get(name: string): string | null {
    return this.read()[normalizeName(name)]?.key ?? null;
  }

  set(name: string, key: string, scope: string | null = null) {
    const clean = key.trim();
    if (!clean) throw new Error("API key is empty");
    if (/\s/.test(clean)) throw new Error("API keys cannot contain whitespace");
    writeJson0600(this.file, { ...this.read(), [normalizeName(name)]: { key: clean, scope } });
  }

  clear(name: string) {
    const { [normalizeName(name)]: _removed, ...rest } = this.read();
    writeJson0600(this.file, rest);
  }
}
