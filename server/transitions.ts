import type { AuditEntry } from "../shared/audit";
import type { AuditLog } from "./audit";
import type { Issue, TeamState, TicketBackend } from "./backend";

/** Marks every comment this plugin posts, so people and other tools can tell them from their own. */
export const COMMENT_PREFIX = "[Paseo] ";

export const MIN_EVIDENCE = 20;
const MAX_TEXT = 4000;

const BLOCKED = 2;
const IN_PROGRESS = 3;
const DONE = 6;
const CANCELED = 99;

// Ranks by name first: Linear types "Ready To Release" as completed, which must not read as closed.
const NAME_RANK: Record<string, number> = {
  todo: 1,
  blocked: BLOCKED,
  "in progress": IN_PROGRESS,
  "in review": 4,
  "ready to release": 5,
  done: DONE,
};
const TYPE_RANK: Record<string, number> = { triage: 0, backlog: 0, unstarted: 1, started: IN_PROGRESS, completed: DONE, canceled: CANCELED };

/** How far along a state is. Forward-only transitions compare these. */
export function rank(state: { name: string; type: string }): number {
  return NAME_RANK[state.name.trim().toLowerCase()] ?? TYPE_RANK[state.type] ?? 0;
}

function pickState(states: TeamState[], logical: "In Progress" | "Done" | "Blocked"): TeamState | null {
  const byName = states.find((s) => s.name.trim().toLowerCase() === logical.toLowerCase());
  if (byName) return byName;
  if (logical === "Blocked") return null;
  // A team that names its states differently: the first started (or completed) state that is not a named intermediate one.
  const type = logical === "In Progress" ? "started" : "completed";
  return (
    [...states]
      .filter((s) => s.type === type && NAME_RANK[s.name.trim().toLowerCase()] === undefined)
      .sort((a, b) => a.position - b.position)[0] ?? null
  );
}

export interface Outcome {
  ok: boolean;
  /** What happened, in words the agent can act on. */
  message: string;
  applied: boolean;
}

type Kind = AuditEntry["kind"];

/**
 * The deterministic status machine. Each call serializes per ticket, is idempotent (a status
 * already reached or passed is skipped, a comment already posted is not posted again), never moves
 * a ticket backwards, never touches a canceled ticket, and leaves an audit entry.
 */
export class Transitions {
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(
    private readonly api: TicketBackend,
    private readonly audit: AuditLog,
  ) {}

  /** Move to In Progress unless the ticket is already at or past it. */
  start(issue: string, agentId: string | null): Promise<Outcome> {
    return this.serial(issue, agentId, "start", (t) => this.move(t, "In Progress"));
  }

  comment(issue: string, agentId: string | null, text: string): Promise<Outcome> {
    return this.serial(issue, agentId, "comment", async (t) => {
      const body = clean(text);
      if (!body) return fail("The comment is empty.");
      return this.post(t, COMMENT_PREFIX + body);
    });
  }

  done(issue: string, agentId: string | null, evidence: string): Promise<Outcome> {
    return this.serial(issue, agentId, "done", async (t) => {
      const proof = clean(evidence);
      if (proof.length < MIN_EVIDENCE) {
        return fail(`ticket_done needs verification evidence (at least ${MIN_EVIDENCE} characters): what you ran or checked, and its result. The ticket was not changed.`);
      }
      const current = rank(t.issue.state);
      if (current >= DONE) return skip(current === CANCELED ? "The ticket is canceled; left as is." : `The ticket is already ${t.issue.state.name}.`, t);
      const posted = await this.post(t, `${COMMENT_PREFIX}Done. Verification: ${proof}`);
      if (!posted.ok) return posted;
      return this.move(t, "Done");
    });
  }

  blocked(issue: string, agentId: string | null, reason: string): Promise<Outcome> {
    return this.serial(issue, agentId, "blocked", async (t) => {
      const why = clean(reason);
      if (!why) return fail("ticket_blocked needs a reason.");
      const current = rank(t.issue.state);
      if (current >= DONE) return skip(current === CANCELED ? "The ticket is canceled; left as is." : `The ticket is already ${t.issue.state.name}.`, t);
      const posted = await this.post(t, `${COMMENT_PREFIX}Blocked: ${why}`);
      if (!posted.ok) return posted;
      return this.move(t, "Blocked");
    });
  }

  /** Current state of the ticket, for the agent's own reading. */
  async status(issue: string): Promise<{ identifier: string; title: string; url: string; state: string } | null> {
    const found = await this.api.issue(issue);
    return found && { identifier: found.identifier, title: found.title, url: found.url, state: found.state.name };
  }

  private serial(issue: string, agentId: string | null, kind: Kind, run: (t: Target) => Promise<Outcome>): Promise<Outcome> {
    const prior = this.chains.get(issue) ?? Promise.resolve();
    const next = prior.then(async () => {
      const t: Target = { key: issue, agentId, kind, issue: null as unknown as Issue };
      try {
        const found = await this.api.issue(issue);
        if (!found) return this.finish(t, fail(`The ticket system shows no ticket ${issue} to the configured credentials.`));
        t.issue = found;
        return this.finish(t, await run(t));
      } catch (err) {
        return this.finish(t, fail((err as Error).message));
      }
    });
    this.chains.set(issue, next.catch(() => undefined));
    return next;
  }

  private finish(t: Target, outcome: Outcome): Outcome {
    this.audit.record({
      issue: t.key,
      agentId: t.agentId,
      kind: t.kind,
      outcome: !outcome.ok ? "failed" : outcome.applied ? "applied" : "skipped",
      from: t.from ?? null,
      to: t.to ?? null,
      detail: t.kind === "comment" && outcome.applied ? (t.body ?? outcome.message) : outcome.message,
    });
    return outcome;
  }

  private async post(t: Target, body: string): Promise<Outcome> {
    // The audit makes a repeated comment (a retried tool call) a no-op.
    if (this.audit.hasApplied(t.key, "comment", body.slice(0, 500))) return skip("That comment was already posted.", t);
    await this.api.comment(t.issue, body);
    t.body = body.slice(0, 500);
    // Recorded here, not only at finish, so that a done/blocked that fails afterwards does not post it twice.
    if (t.kind !== "comment") this.audit.record({ issue: t.key, agentId: t.agentId, kind: "comment", outcome: "applied", from: null, to: null, detail: t.body });
    return { ok: true, applied: true, message: `Commented on ${t.key}.` };
  }

  private async move(t: Target, logical: "In Progress" | "Done" | "Blocked"): Promise<Outcome> {
    const current = t.issue.state;
    t.from = current.name;
    const from = rank(current);
    if (from === CANCELED) return skip("The ticket is canceled; left as is.", t);
    const states = await this.api.states(t.issue);
    const target = pickState(states, logical);
    if (!target) return skip(`The team has no ${logical} state; status left as ${current.name}.`, t);
    const to = logical === "Blocked" ? BLOCKED : logical === "Done" ? DONE : IN_PROGRESS;
    if (logical === "Blocked" ? from === BLOCKED : from >= to) return skip(`The ticket is already ${current.name}.`, t);
    await this.api.setState(t.issue, target.id);
    t.to = target.name;
    return { ok: true, applied: true, message: `Moved ${t.key} from ${current.name} to ${target.name}.` };
  }
}

interface Target {
  key: string;
  agentId: string | null;
  kind: Kind;
  issue: Issue;
  from?: string;
  to?: string;
  body?: string;
}

function clean(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_TEXT ? `${trimmed.slice(0, MAX_TEXT)}\n[truncated]` : trimmed;
}

function fail(message: string): Outcome {
  return { ok: false, applied: false, message };
}

function skip(message: string, t: Target): Outcome {
  t.from ??= t.issue?.state?.name;
  return { ok: true, applied: false, message };
}
