import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AuditLog } from "./audit";
import type { Issue, TeamState, TicketBackend } from "./backend";
import { Transitions } from "./transitions";

export const tmp = () => mkdtempSync(path.join(tmpdir(), "lin-"));

export const STATES: TeamState[] = [
  { id: "s-backlog", name: "Backlog", type: "backlog", position: 0 },
  { id: "s-todo", name: "Todo", type: "unstarted", position: 1 },
  { id: "s-blocked", name: "Blocked", type: "started", position: 1.5 },
  { id: "s-prog", name: "In Progress", type: "started", position: 2 },
  { id: "s-review", name: "In Review", type: "started", position: 3 },
  // Linear types this as completed, which must not read as closed.
  { id: "s-rtr", name: "Ready To Release", type: "completed", position: 4 },
  { id: "s-done", name: "Done", type: "completed", position: 5 },
  { id: "s-canceled", name: "Canceled", type: "canceled", position: 6 },
];

/** In-memory Linear: tickets by key, with the calls it received. */
export class FakeLinear implements TicketBackend {
  readonly comments: { key: string; body: string }[] = [];
  readonly moves: { key: string; to: string }[] = [];
  failComment = false;
  failSetState = false;

  constructor(
    private readonly teamStates: TeamState[] = STATES,
    private readonly issues: Record<string, string> = {},
  ) {}

  add(key: string, stateName: string) {
    this.issues[key] = stateName;
  }

  stateOf(key: string) {
    return this.issues[key];
  }

  async issue(key: string): Promise<Issue | null> {
    const name = this.issues[key];
    if (!name) return null;
    const s = this.teamStates.find((x) => x.name === name)!;
    return {
      id: `id-${key}`,
      identifier: key,
      title: `Title of ${key}`,
      url: `https://linear.app/acme/issue/${key}`,
      state: { id: s.id, name: s.name, type: s.type },
      team: { id: "team-1", key: key.split("-")[0] },
      workspace: "acme",
    };
  }

  async states(): Promise<TeamState[]> {
    return this.teamStates;
  }

  async setState(issue: Issue, stateId: string): Promise<void> {
    if (this.failSetState) throw new Error("Linear is down");
    const s = this.teamStates.find((x) => x.id === stateId)!;
    this.issues[issue.identifier] = s.name;
    this.moves.push({ key: issue.identifier, to: s.name });
  }

  async comment(issue: Issue, body: string): Promise<void> {
    if (this.failComment) throw new Error("Linear is down");
    this.comments.push({ key: issue.identifier, body });
  }
}

export function setup(states: TeamState[] = STATES) {
  const linear = new FakeLinear(states);
  const audit = new AuditLog(path.join(tmp(), "audit.jsonl"));
  return { linear, audit, transitions: new Transitions(linear, audit) };
}
