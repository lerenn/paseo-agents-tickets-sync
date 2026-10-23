import { appendFileSync, chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { auditEntrySchema, type AuditEntry } from "../shared/audit";

export const defaultAuditPath = path.join(homedir(), ".paseo", "plugin-data", "tickets-dispatcher", "audit.jsonl");

const KEEP = 2000;

/** Append-only record of every transition attempt. Also what makes comments idempotent. */
export class AuditLog {
  private entries: AuditEntry[];

  constructor(private readonly file: string = defaultAuditPath) {
    this.entries = this.load();
    if (this.entries.length > KEEP) {
      this.entries = this.entries.slice(-KEEP);
      this.rewrite();
    }
  }

  private load(): AuditEntry[] {
    try {
      return readFileSync(this.file, "utf8")
        .split("\n")
        .filter(Boolean)
        .flatMap((line) => {
          const parsed = auditEntrySchema.safeParse(JSON.parse(line));
          return parsed.success ? [parsed.data] : [];
        });
    } catch {
      return [];
    }
  }

  private rewrite() {
    mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    writeFileSync(this.file, this.entries.map((e) => JSON.stringify(e)).join("\n") + "\n", { mode: 0o600 });
    chmodSync(this.file, 0o600);
  }

  record(entry: Omit<AuditEntry, "at">): AuditEntry {
    const full = { ...entry, at: Date.now() };
    this.entries.push(full);
    mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    appendFileSync(this.file, JSON.stringify(full) + "\n", { mode: 0o600 });
    chmodSync(this.file, 0o600);
    if (this.entries.length > KEEP * 1.5) {
      this.entries = this.entries.slice(-KEEP);
      this.rewrite();
    }
    return full;
  }

  /** Newest first. */
  recent(limit = 100): AuditEntry[] {
    return this.entries.slice(-limit).reverse();
  }

  /** True when a comment with this exact detail was already applied on the issue. */
  hasApplied(issue: string, kind: AuditEntry["kind"], detail: string): boolean {
    return this.entries.some((e) => e.issue === issue && e.kind === kind && e.outcome === "applied" && e.detail === detail);
  }
}
