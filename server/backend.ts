import type { BackendId } from "../shared/backends";

export interface TeamState {
  id: string;
  name: string;
  type: string;
  position: number;
}

export interface Issue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  state: { id: string; name: string; type: string };
  team: { id: string; key: string };
  /** Which backend produced this issue, so later calls go back to it. */
  backend: BackendId;
  /** Backend-specific scope that can see this issue (for Linear, the name of the stored API key). */
  workspace: string;
}

/**
 * What the transition engine needs from a ticket system. Linear is the first backend; anything
 * that can read a ticket, list its team's states, set one and comment can sit behind this.
 */
export interface TicketBackend {
  /** Checks a credential and says what it gives access to. Throws when it is refused. */
  validateCredential(credential: string): Promise<{ scope: string; user: string }>;
  /** Null when no configured workspace can see the issue. */
  issue(key: string): Promise<Issue | null>;
  states(issue: Issue): Promise<TeamState[]>;
  setState(issue: Issue, stateId: string): Promise<void>;
  comment(issue: Issue, body: string): Promise<void>;
}


export class NoKeyError extends Error {
  constructor() {
    super("No connection is configured. Add one in the Agents Tickets Sync screen.");
  }
}
