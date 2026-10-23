import type { BoundAgent } from "../shared/rpc";
import type { BindingStore } from "./bindings";
import type { BackendId } from "../shared/backends";
import type { RoutedBackend } from "./backends";
import type { KeyStore } from "./keys";

const STATE_TTL_MS = 60_000;

/** Backs the screen's RPCs: keys (write-only) and the bound agents with their tickets' live state. */
export class TicketService {
  private readonly cache = new Map<string, { at: number; state: string | null; title: string | null; url: string | null }>();

  constructor(
    private readonly keys: KeyStore,
    private readonly bindings: BindingStore,
    private readonly backend: RoutedBackend,
    private readonly endpoint: () => { url: string | null; error: string | null },
    private readonly now: () => number = Date.now,
  ) {}

  private async ticket(issue: string) {
    const hit = this.cache.get(issue);
    if (hit && this.now() - hit.at < STATE_TTL_MS) return hit;
    let value = { at: this.now(), state: null as string | null, title: null as string | null, url: null as string | null };
    try {
      const found = await this.backend.issue(issue);
      if (found) value = { ...value, state: found.state.name, title: found.title, url: found.url };
    } catch {
      // Linear unreachable or no key: the screen shows the ticket without a state.
    }
    this.cache.set(issue, value);
    return value;
  }

  async status() {
    const agents: BoundAgent[] = await Promise.all(
      this.bindings.list().map(async (b) => {
        const t = this.keys.names().length ? await this.ticket(b.issue) : { state: null, title: null, url: null };
        return {
          agentId: b.agentId ?? null,
          issue: b.issue,
          cwd: b.cwd,
          started: Boolean(b.started),
          archived: Boolean(b.archivedAt),
          state: t.state,
          title: t.title,
          url: t.url,
          createdAt: b.createdAt,
        };
      }),
    );
    return {
      backends: this.backend.info(),
      workspaces: this.keys.names().map((name) => ({ name, backend: this.keys.backend(name)!, scope: this.keys.scope(name) })),
       endpoint: this.endpoint(), agents };
  }

  async setKey(backend: BackendId, name: string, key: string) {
    const who = await this.backend.validate(backend, key.trim());
    this.keys.set(backend, name, key, who.scope);
    this.cache.clear();
    return who;
  }

  clearKey(name: string) {
    this.keys.clear(name);
    this.cache.clear();
  }
}
