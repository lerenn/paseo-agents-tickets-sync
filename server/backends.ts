import { parseLinearKey } from "../shared/plugin";
import type { BackendId } from "../shared/settings";
import type { TicketBackend } from "./backend";
import type { KeyStore } from "./keys";
import { LinearClient } from "./linear";

export interface BackendDef {
  id: BackendId;
  label: string;
  /** Normalizes a ticket reference from PASEO_AGENT_TICKET, or null when it is not one of this backend's. */
  parseKey(value: string): string | null;
  create(deps: { keys: KeyStore }): TicketBackend;
}

export const BACKENDS: Record<BackendId, BackendDef> = {
  linear: {
    id: "linear",
    label: "Linear",
    parseKey: parseLinearKey,
    create: ({ keys }) => new LinearClient(keys),
  },
};

/**
 * Follows the backend selected in the settings. Instances are built once and kept, so a backend's
 * caches survive; switching the setting changes where the next call goes. An unreadable setting
 * falls back to Linear, the only backend there is.
 */
export class SelectedBackend implements TicketBackend {
  private readonly instances = new Map<BackendId, TicketBackend>();

  constructor(
    private readonly selected: () => Promise<BackendId>,
    private readonly deps: { keys: KeyStore },
  ) {}

  async current(): Promise<{ def: BackendDef; backend: TicketBackend }> {
    const def = BACKENDS[await this.selected()] ?? BACKENDS.linear;
    let backend = this.instances.get(def.id);
    if (!backend) {
      backend = def.create(this.deps);
      this.instances.set(def.id, backend);
    }
    return { def, backend };
  }

  async validateCredential(credential: string) {
    return (await this.current()).backend.validateCredential(credential);
  }
  async issue(key: string) {
    return (await this.current()).backend.issue(key);
  }
  async states(issue: Parameters<TicketBackend["states"]>[0]) {
    return (await this.current()).backend.states(issue);
  }
  async setState(issue: Parameters<TicketBackend["setState"]>[0], stateId: string) {
    return (await this.current()).backend.setState(issue, stateId);
  }
  async comment(issue: Parameters<TicketBackend["comment"]>[0], body: string) {
    return (await this.current()).backend.comment(issue, body);
  }
}
