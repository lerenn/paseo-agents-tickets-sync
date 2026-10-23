import type { PluginHookContext } from "@getpaseo/plugin/server";
import type { DispatchSettings, LedgerView, TeamConfig } from "../shared/dispatch";
import { TICKET_ENV } from "../shared/plugin";
import type { Issue, TicketBackend } from "./backend";
import type { BindingStore } from "./bindings";
import type { ConfigState } from "./config";
import type { Ledger, LedgerEntry } from "./ledger";

export type Paseo = PluginHookContext["paseo"];

/** The role variable agent-roles reads. */
export const ROLE_ENV = "PASEO_AGENT_ROLE";

const ACTIVE = new Set(["initializing", "running"]);
const STARTING_GRACE_MS = 2 * 60_000;
const MAX_DESCRIPTION = 4000;

export interface Waiting {
  issue: string;
  title: string;
  team: string;
  url: string;
  state: string;
}

export function slug(text: string, max = 40): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

/** The first role whose ticket label the issue carries (labels compare case-insensitively). */
export function roleFor(team: TeamConfig, labels: string[] | undefined): string | undefined {
  const have = new Set((labels ?? []).map((l) => l.toLowerCase()));
  for (const [label, role] of Object.entries(team.roles)) if (have.has(label.toLowerCase())) return role;
  return undefined;
}

export function promptFor(issue: Issue): string {
  const description = (issue.description ?? "").trim();
  const body = description.length > MAX_DESCRIPTION ? `${description.slice(0, MAX_DESCRIPTION)}\n[truncated]` : description;
  return [`Work on ticket ${issue.identifier}: ${issue.title}`, issue.url, body && `\n${body}`].filter(Boolean).join("\n");
}

export interface DispatcherDeps {
  backend: TicketBackend;
  ledger: Ledger;
  bindings: BindingStore;
  config: () => ConfigState;
  settings: () => Promise<DispatchSettings>;
  paseo: () => Paseo | null;
  now?: () => number;
}

/**
 * Starts agents for tickets, in the Paseo project their team maps to, each in its own worktree
 * workspace. The ledger is written before anything is created and is never cleared by polling, so a
 * ticket is dispatched automatically at most once.
 */
export class Dispatcher {
  lastPollAt: number | null = null;
  lastPollError: string | null = null;
  waiting: Waiting[] = [];
  private polling = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(private readonly deps: DispatcherDeps) {}

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  private requirePaseo(): Paseo {
    const paseo = this.deps.paseo();
    if (!paseo) throw new Error("The Paseo API is not available yet. Open the screen or start any agent, then retry.");
    return paseo;
  }

  /** Project id for a configured id or name, or null when no such project exists. */
  async resolveProject(paseo: Paseo, ref: string): Promise<string | null> {
    const { projects } = await paseo.projects.list();
    const wanted = ref.trim().toLowerCase();
    const byId = projects.find((p) => p.projectId === ref.trim());
    if (byId) return byId.projectId;
    const byName = projects.find((p) => [p.projectCustomName, p.projectDisplayName].some((n) => n?.trim().toLowerCase() === wanted));
    return byName?.projectId ?? null;
  }

  /** Ids of agents that are working right now (not idle, errored, closed or archived). */
  async activeAgents(paseo: Paseo): Promise<Set<string>> {
    const { entries } = await paseo.agents.list();
    return new Set(entries.filter((e) => ACTIVE.has(e.agent.status) && !e.agent.archivedAt).map((e) => e.agent.id));
  }

  async runningCount(paseo: Paseo): Promise<number> {
    const active = await this.activeAgents(paseo);
    return this.deps.ledger.list().filter((e) => e.agentId && active.has(e.agentId)).length;
  }

  /** The ledger with whether each agent is still working. */
  async view(): Promise<LedgerView[]> {
    const paseo = this.deps.paseo();
    let active = new Set<string>();
    if (paseo) {
      try {
        active = await this.activeAgents(paseo);
      } catch {
        // Unknown: shown as not active.
      }
    }
    return this.deps.ledger.list().map((e) => ({ ...e, active: Boolean(e.agentId && active.has(e.agentId)) }));
  }

  private async launch(issue: Issue, mode: LedgerEntry["mode"]): Promise<{ agentId: string; workspaceId: string | null }> {
    const { config } = this.deps.config();
    const team = config.teams[issue.team.key.toUpperCase()];
    if (!team) throw new Error(`No project is configured for team ${issue.team.key}.`);
    const paseo = this.requirePaseo();
    const projectId = await this.resolveProject(paseo, team.project);
    if (!projectId) throw new Error(`Paseo has no project "${team.project}" (team ${issue.team.key}).`);

    const key = issue.identifier;
    this.deps.ledger.put({ issue: key, title: issue.title, mode, status: "starting", at: this.now(), agentId: null, workspaceId: null, error: null });
    try {
      const role = roleFor(team, issue.labels);
      const workspace = await paseo.workspaces.create({
        title: `${key}: ${issue.title}`,
        source: { kind: "worktree", projectId, action: "branch-off", branchName: `${key.toLowerCase()}-${slug(issue.title)}`.replace(/-+$/g, "") },
      });
      const agent = await workspace.agents.create({
        config: { provider: team.provider ?? config.provider },
        title: `${key}: ${issue.title}`,
        prompt: promptFor(issue),
        env: { [TICKET_ENV]: key, ...(role ? { [ROLE_ENV]: role } : {}) },
      });
      this.deps.ledger.update(key, { status: "started", agentId: agent.id, workspaceId: workspace.id });
      return { agentId: agent.id, workspaceId: workspace.id };
    } catch (error) {
      this.deps.ledger.update(key, { status: "failed", error: (error as Error).message.slice(0, 300) });
      throw error;
    }
  }

  /** What the screen shows about dispatch. */
  async status(settings: DispatchSettings, sync: { configured: boolean; syncedAt: number | null }) {
    const { config } = this.deps.config();
    const paseo = this.deps.paseo();
    const teams = await Promise.all(
      Object.entries(config.teams).map(async ([team, t]) => {
        let found = true;
        if (paseo) {
          try {
            found = Boolean(await this.resolveProject(paseo, t.project));
          } catch {
            found = true;
          }
        }
        return { team, project: t.project, projectFound: found, label: t.label ?? settings.defaultLabel, states: t.states };
      }),
    );
    const dispatched = await this.view();
    return {
      configured: sync.configured,
      configError: this.deps.config().error,
      configSyncedAt: sync.syncedAt,
      teams,
      auto: settings.auto,
      pollSeconds: settings.pollSeconds,
      maxConcurrent: settings.maxConcurrent,
      running: dispatched.filter((d) => d.active).length,
      lastPollAt: this.lastPollAt,
      lastPollError: this.lastPollError,
      waiting: this.waiting,
      dispatched,
    };
  }

  /** Start an agent on a ticket now, whatever its label, state or the concurrency limit. */
  async start(rawKey: string): Promise<{ agentId: string; workspaceId: string | null }> {
    const key = rawKey.trim().toUpperCase();
    const paseo = this.requirePaseo();
    const issue = await this.deps.backend.issue(key);
    if (!issue) throw new Error(`No ticket ${key} is visible to the configured connections.`);
    const active = await this.activeAgents(paseo);
    const entry = this.deps.ledger.get(key);
    if (entry?.status === "starting" && this.now() - entry.at < STARTING_GRACE_MS) throw new Error(`${key} is being started.`);
    if (entry?.agentId && active.has(entry.agentId)) throw new Error(`${key} already has a running agent.`);
    if (this.deps.bindings.list().some((b) => b.issue === key && b.agentId && !b.archivedAt && active.has(b.agentId))) {
      throw new Error(`An agent bound to ${key} is already running.`);
    }
    return this.launch(issue, "manual");
  }

  /** One automatic pass: ask the backend for labelled tickets and start agents up to the limit. */
  async pollOnce(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const settings = await this.deps.settings();
      if (!settings.auto) return;
      const paseo = this.deps.paseo();
      if (!paseo) {
        this.lastPollError = "The Paseo API is not available yet.";
        return;
      }
      const { config } = this.deps.config();
      const waiting: Waiting[] = [];
      const candidates: Issue[] = [];
      this.lastPollError = null;
      for (const [teamKey, team] of Object.entries(config.teams)) {
        try {
          const issues = await this.deps.backend.list({
            team: teamKey,
            label: team.label ?? settings.defaultLabel,
            stateTypes: team.states,
            connection: team.connection,
          });
          candidates.push(...issues.filter((i) => !this.deps.ledger.has(i.identifier)));
        } catch (error) {
          this.lastPollError = `${teamKey}: ${(error as Error).message}`;
        }
      }
      const bound = new Set(this.deps.bindings.list().filter((b) => !b.archivedAt).map((b) => b.issue));
      const fresh = candidates.filter((i) => !bound.has(i.identifier));
      let slots = Number.POSITIVE_INFINITY;
      if (settings.maxConcurrent > 0) slots = settings.maxConcurrent - (await this.runningCount(paseo));
      for (const issue of fresh) {
        if (slots <= 0) {
          waiting.push(toWaiting(issue));
          continue;
        }
        try {
          await this.launch(issue, "auto");
          slots -= 1;
        } catch (error) {
          this.lastPollError = `${issue.identifier}: ${(error as Error).message}`;
        }
      }
      this.waiting = waiting;
    } catch (error) {
      this.lastPollError = (error as Error).message;
    } finally {
      this.lastPollAt = this.now();
      this.polling = false;
    }
  }

  /** Polls now and then every `pollSeconds` (never under a minute), reading the settings each time. */
  startPolling() {
    this.stopped = false;
    const tick = async () => {
      await this.pollOnce();
      if (this.stopped) return;
      let seconds = 60;
      try {
        seconds = Math.max(60, (await this.deps.settings()).pollSeconds);
      } catch {
        // Keep the minimum.
      }
      this.timer = setTimeout(() => void tick(), seconds * 1000);
    };
    this.timer = setTimeout(() => void tick(), 5_000);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
}

function toWaiting(issue: Issue): Waiting {
  return { issue: issue.identifier, title: issue.title, team: issue.team.key, url: issue.url, state: issue.state.name };
}
