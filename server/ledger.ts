import { homedir } from "node:os";
import path from "node:path";
import { readJson, writeJson0600 } from "./files";

export const defaultLedgerPath = path.join(homedir(), ".paseo", "plugin-data", "tickets-dispatcher", "dispatched.json");

export interface LedgerEntry {
  issue: string;
  title: string | null;
  mode: "auto" | "manual";
  status: "starting" | "started" | "failed";
  at: number;
  agentId: string | null;
  workspaceId: string | null;
  error: string | null;
}

/**
 * Every ticket the dispatcher started (or tried to). It is written before the agent is created, so a
 * crash or a retry can never start a second agent for the same ticket on its own: automatic
 * dispatch skips any ticket that has an entry, whatever became of its agent.
 */
export class Ledger {
  private entries: Record<string, LedgerEntry>;

  constructor(private readonly file: string = defaultLedgerPath) {
    this.entries = readJson(this.file, {});
  }

  get(issue: string): LedgerEntry | undefined {
    return this.entries[issue];
  }

  has(issue: string): boolean {
    return issue in this.entries;
  }

  put(entry: LedgerEntry) {
    this.entries[entry.issue] = entry;
    writeJson0600(this.file, this.entries);
  }

  update(issue: string, patch: Partial<LedgerEntry>) {
    const current = this.entries[issue];
    if (!current) return;
    this.put({ ...current, ...patch });
  }

  /** Newest first. */
  list(): LedgerEntry[] {
    return Object.values(this.entries).sort((a, b) => b.at - a.at);
  }
}
