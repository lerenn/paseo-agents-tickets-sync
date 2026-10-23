import { type BackendId, type BackendInfo } from "../shared/backends";
import { parseLinearKey } from "../shared/plugin";
import { NoKeyError, type Issue, type ListQuery, type TicketBackend } from "./backend";
import type { KeyStore } from "./keys";
import { LinearClient } from "./linear";

export interface BackendDef {
  id: BackendId;
  label: string;
  /** A Lucide icon name for the screen. */
  icon: string;
  /** Normalizes a ticket reference from PASEO_AGENT_TICKET, or null when it is not one of this backend's. */
  parseKey(value: string): string | null;
  create(deps: { keys: KeyStore }): TicketBackend;
}

/** Adding a backend is an entry here, a value in BACKEND_IDS, and a TicketBackend implementation. */
export const BACKENDS: Record<BackendId, BackendDef> = {
  linear: {
    id: "linear",
    label: "Linear",
    icon: "CircleDot",
    parseKey: parseLinearKey,
    create: ({ keys }) => new LinearClient(keys),
  },
};

/**
 * Sends each call to the backend that owns the connection. A ticket key is looked up only in
 * backends that have a connection and whose key format accepts it; once found, the issue carries
 * its backend, so later calls on it go back to the same one.
 */
export class RoutedBackend implements TicketBackend {
  private readonly instances = new Map<BackendId, TicketBackend>();

  constructor(
    private readonly keys: KeyStore,
    private readonly defs: Record<string, BackendDef> = BACKENDS,
  ) {}

  /** What the screen offers in the backend dropdown. */
  info(): BackendInfo[] {
    return Object.values(this.defs).map(({ id, label, icon }) => ({ id, label, icon }));
  }

  private backendOf(id: BackendId): TicketBackend {
    const def = this.defs[id];
    if (!def) throw new Error(`Unknown ticket backend: ${id}`);
    let backend = this.instances.get(id);
    if (!backend) {
      backend = def.create({ keys: this.keys });
      this.instances.set(id, backend);
    }
    return backend;
  }

  /** The first backend whose key format accepts the reference. */
  parseKey(value: string): string | null {
    for (const def of Object.values(this.defs)) {
      const key = def.parseKey(value);
      if (key) return key;
    }
    return null;
  }

  /** Validates a credential with the named backend. */
  validate(backend: BackendId, credential: string) {
    return this.backendOf(backend).validateCredential(credential);
  }

  validateCredential(): never {
    throw new Error("Name the backend: use validate(backend, credential).");
  }

  async issue(key: string): Promise<Issue | null> {
    const connected = [...new Set(this.keys.names().map((n) => this.keys.backend(n)!))];
    if (connected.length === 0) throw new NoKeyError();
    let lastError: Error | null = null;
    for (const id of connected) {
      if (!this.defs[id]?.parseKey(key)) continue;
      try {
        const found = await this.backendOf(id).issue(key);
        if (found) return found;
      } catch (err) {
        lastError = err as Error;
      }
    }
    if (lastError) throw lastError;
    return null;
  }

  /** Lists in every backend that has a connection (the team key does not say which). */
  async list(query: ListQuery): Promise<Issue[]> {
    const connected = [...new Set(this.keys.names().map((n) => this.keys.backend(n)!))];
    if (connected.length === 0) throw new NoKeyError();
    const found: Issue[] = [];
    for (const id of connected) {
      if (!this.defs[id]?.parseKey(`${query.team}-1`)) continue;
      found.push(...(await this.backendOf(id).list(query)));
    }
    return found;
  }

  states(issue: Issue) {
    return this.backendOf(issue.backend).states(issue);
  }
  setState(issue: Issue, stateId: string) {
    return this.backendOf(issue.backend).setState(issue, stateId);
  }
  comment(issue: Issue, body: string) {
    return this.backendOf(issue.backend).comment(issue, body);
  }
}
