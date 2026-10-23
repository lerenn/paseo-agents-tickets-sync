import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CONFIG_FILE, dispatchConfigSchema, type DispatchConfig } from "../shared/dispatch";

export interface ConfigState {
  config: DispatchConfig;
  /** Why the file could not be used, else null. The previous good config is kept. */
  error: string | null;
}

export const EMPTY_CONFIG: DispatchConfig = { provider: "claude", teams: {} };

/** Reads and validates dispatch.json from a folder, with team keys upper-cased. */
export function readConfig(folder: string): { config: DispatchConfig } | { error: string } {
  let text: string;
  try {
    text = readFileSync(path.join(folder, CONFIG_FILE), "utf8");
  } catch {
    return { error: `${CONFIG_FILE} not found in the config source folder.` };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return { error: `${CONFIG_FILE} is not valid JSON: ${(err as Error).message}` };
  }
  const parsed = dispatchConfigSchema.safeParse(json);
  if (!parsed.success) return { error: `${CONFIG_FILE}: ${z.prettifyError(parsed.error).replace(/\n/g, "; ")}` };
  const teams = Object.fromEntries(Object.entries(parsed.data.teams).map(([k, v]) => [k.toUpperCase(), v]));
  return { config: { ...parsed.data, teams } };
}

/** Keeps the last good config and re-reads it after each git sync. */
export class ConfigService {
  state: ConfigState = { config: EMPTY_CONFIG, error: null };
  /** Whether a config was ever read successfully (an empty one does not count as configured). */
  loaded = false;
  syncedAt: number | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  load(folder: string) {
    const result = readConfig(folder);
    if ("error" in result) {
      this.state = { config: this.state.config, error: result.error };
      return;
    }
    this.state = { config: result.config, error: null };
    this.loaded = true;
    this.syncedAt = this.now();
  }

  fail(error: string) {
    this.state = { config: this.state.config, error };
  }
}
