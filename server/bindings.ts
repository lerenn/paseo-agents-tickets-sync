import { randomBytes, timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { readJson, writeJson0600 } from "./files";

export const defaultBindingsPath = path.join(homedir(), ".paseo", "plugin-data", "tickets-dispatcher", "bindings.json");

export interface Binding {
  issue: string;
  cwd: string;
  /** Set when the agent's session opens. */
  agentId?: string;
  createdAt: number;
  /** The start transition was applied or found already satisfied. */
  started?: boolean;
  archivedAt?: number;
}

const UNBOUND_TTL_MS = 7 * 24 * 3600 * 1000;
const ARCHIVED_TTL_MS = 7 * 24 * 3600 * 1000;

/**
 * Per-agent capability tokens, each tied to one ticket. The ticket comes from the agent's
 * environment at creation and cannot be changed by the agent: the tools take no ticket argument.
 * Persisted so agents resumed after a daemon restart keep working.
 */
export class BindingStore {
  private bindings: Record<string, Binding>;

  constructor(
    private readonly file: string = defaultBindingsPath,
    private readonly now: () => number = Date.now,
  ) {
    this.bindings = readJson(this.file, {});
    this.prune();
  }

  private save() {
    writeJson0600(this.file, this.bindings);
  }

  create(issue: string, cwd: string): string {
    const token = randomBytes(24).toString("base64url");
    this.bindings[token] = { issue, cwd, createdAt: this.now() };
    this.save();
    return token;
  }

  /** Constant-time lookup. */
  resolve(token: string | undefined): Binding | null {
    if (!token) return null;
    const candidate = Buffer.from(token);
    let found: Binding | null = null;
    for (const [known, binding] of Object.entries(this.bindings)) {
      const k = Buffer.from(known);
      if (k.length === candidate.length && timingSafeEqual(k, candidate)) found = binding;
    }
    return found;
  }

  bind(token: string, agentId: string): Binding | null {
    const binding = this.bindings[token];
    if (!binding) return null;
    binding.agentId = agentId;
    delete binding.archivedAt;
    this.save();
    return binding;
  }

  markStarted(agentId: string) {
    for (const binding of Object.values(this.bindings)) if (binding.agentId === agentId) binding.started = true;
    this.save();
  }

  /** Kept for a while so the screen can still show where the agent's ticket ended up. */
  archive(agentId: string) {
    for (const binding of Object.values(this.bindings)) if (binding.agentId === agentId) binding.archivedAt = this.now();
    this.save();
  }

  list(): Binding[] {
    return Object.values(this.bindings).sort((a, b) => b.createdAt - a.createdAt);
  }

  private prune() {
    const t = this.now();
    let changed = false;
    for (const [token, b] of Object.entries(this.bindings)) {
      if ((!b.agentId && b.createdAt < t - UNBOUND_TTL_MS) || (b.archivedAt && b.archivedAt < t - ARCHIVED_TTL_MS)) {
        delete this.bindings[token];
        changed = true;
      }
    }
    if (changed) this.save();
  }
}
