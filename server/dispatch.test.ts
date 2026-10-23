import path from "node:path";
import { describe, expect, it } from "vitest";
import { dispatchSettings, type DispatchSettings } from "../shared/dispatch";
import type { Issue } from "./backend";
import { BindingStore } from "./bindings";
import { EMPTY_CONFIG, type ConfigState } from "./config";
import { Dispatcher, promptFor, roleFor, slug, type Paseo } from "./dispatch";
import { Ledger } from "./ledger";
import { FakeLinear, tmp } from "./testing";

const PROJECTS = [
  { projectId: "prj_monorepo", projectDisplayName: "Monorepo", projectCustomName: null },
  { projectId: "prj_growth", projectDisplayName: "Growth", projectCustomName: null },
];

function issue(key: string, extra: Partial<Issue> = {}): Issue {
  return {
    id: `id-${key}`, identifier: key, title: `Title of ${key}`, url: `https://linear.app/x/issue/${key}`, description: "Do the thing.",
    state: { id: "s", name: "Todo", type: "unstarted" }, team: { id: "t", key: key.split("-")[0] }, workspace: "acme", backend: "linear", labels: ["paseo"], ...extra,
  };
}

function setup(opts: { settings?: Partial<DispatchSettings>; config?: ConfigState; agents?: { id: string; status: string; archivedAt?: string | null }[]; hasPaseo?: boolean } = {}) {
  const dir = tmp();
  const linear = new FakeLinear();
  const created: { workspace: any; agent: any }[] = [];
  let next = 1;
  const agents = opts.agents ?? [];
  const paseo = {
    projects: { list: async () => ({ projects: PROJECTS }) },
    agents: { list: async () => ({ entries: agents.map((agent) => ({ agent })) }) },
    workspaces: {
      create: async (workspace: any) => {
        const n = next++;
        return {
          id: `wks_${n}`,
          agents: {
            create: async (agent: any) => {
              created.push({ workspace, agent });
              agents.push({ id: `agent-${n}`, status: "running" });
              return { id: `agent-${n}` };
            },
          },
        };
      },
    },
  } as unknown as Paseo;
  const config: ConfigState = opts.config ?? {
    config: {
      provider: "claude",
      teams: {
        ANY: { project: "Monorepo", states: ["unstarted"], roles: { reviewer: "reviewer" } },
        DVRL: { project: "prj_growth", label: "growth", states: ["unstarted"], roles: {}, provider: "codex" },
      },
    },
    error: null,
  };
  const settings = { ...dispatchSettings.schema.parse({}), auto: true, ...opts.settings } as DispatchSettings;
  const ledger = new Ledger(path.join(dir, "dispatched.json"));
  const bindings = new BindingStore(path.join(dir, "bindings.json"));
  const dispatcher = new Dispatcher({
    backend: linear,
    ledger,
    bindings,
    config: () => config,
    settings: async () => settings,
    paseo: () => (opts.hasPaseo === false ? null : paseo),
  });
  return { dispatcher, linear, ledger, bindings, created, agents, settings };
}

describe("helpers", () => {
  it("slugs titles", () => {
    expect(slug("Fix the Login Bug!! (urgent)")).toBe("fix-the-login-bug-urgent");
    expect(slug("x".repeat(100)).length).toBe(40);
    expect(slug("***")).toBe("");
  });
  it("maps the first matching ticket label to a role, case-insensitively", () => {
    const team = { project: "p", states: ["unstarted" as const], roles: { Reviewer: "reviewer", infra: "ops" } };
    expect(roleFor(team, ["bug", "reviewer"])).toBe("reviewer");
    expect(roleFor(team, ["bug"])).toBeUndefined();
    expect(roleFor(team, undefined)).toBeUndefined();
  });
  it("builds a prompt from the ticket and truncates a long description", () => {
    expect(promptFor(issue("ANY-1"))).toContain("Work on ticket ANY-1: Title of ANY-1");
    expect(promptFor(issue("ANY-1", { description: "y".repeat(5000) }))).toMatch(/\[truncated\]$/);
  });
});

describe("pollOnce", () => {
  it("does nothing while auto dispatch is off", async () => {
    const t = setup({ settings: { auto: false } });
    t.linear.listed = [issue("ANY-1")];
    await t.dispatcher.pollOnce();
    expect(t.linear.lists).toEqual([]);
    expect(t.created).toEqual([]);
  });

  it("starts an agent per labelled ticket in the team's project, with the binding env", async () => {
    const t = setup();
    t.linear.listed = [issue("ANY-1"), issue("DVRL-2")];
    await t.dispatcher.pollOnce();
    expect(t.created).toHaveLength(2);
    const any = t.created[0];
    expect(any.workspace.source).toMatchObject({ kind: "worktree", projectId: "prj_monorepo", action: "branch-off", branchName: "any-1-title-of-any-1" });
    expect(any.agent.env).toEqual({ PASEO_AGENT_TICKET: "ANY-1" });
    expect(any.agent.config).toEqual({ provider: "claude" });
    expect(t.created[1].workspace.source.projectId).toBe("prj_growth");
    expect(t.created[1].agent.config).toEqual({ provider: "codex" });
    expect(t.ledger.get("ANY-1")).toMatchObject({ status: "started", mode: "auto", agentId: "agent-1" });
  });

  it("queries each team with its own label, state types and the default label otherwise", async () => {
    const t = setup({ settings: { defaultLabel: "ai" } });
    await t.dispatcher.pollOnce();
    expect(t.linear.lists).toEqual([
      { team: "ANY", label: "ai", stateTypes: ["unstarted"], connection: undefined },
      { team: "DVRL", label: "growth", stateTypes: ["unstarted"], connection: undefined },
    ]);
  });

  it("sets PASEO_AGENT_ROLE from a ticket label", async () => {
    const t = setup();
    t.linear.listed = [issue("ANY-1", { labels: ["paseo", "Reviewer"] })];
    await t.dispatcher.pollOnce();
    expect(t.created[0].agent.env).toEqual({ PASEO_AGENT_TICKET: "ANY-1", PASEO_AGENT_ROLE: "reviewer" });
  });

  it("never dispatches the same ticket twice, even after its agent is gone", async () => {
    const t = setup();
    t.linear.listed = [issue("ANY-1")];
    await t.dispatcher.pollOnce();
    t.agents.length = 0;
    await t.dispatcher.pollOnce();
    await t.dispatcher.pollOnce();
    expect(t.created).toHaveLength(1);
  });

  it("skips a ticket that already has a live bound agent", async () => {
    const t = setup();
    const token = t.bindings.create("ANY-1", "/w");
    t.bindings.bind(token, "someone");
    t.linear.listed = [issue("ANY-1")];
    await t.dispatcher.pollOnce();
    expect(t.created).toEqual([]);
  });

  it("respects the concurrency limit and lists the rest as waiting", async () => {
    const t = setup({ settings: { maxConcurrent: 2 } });
    t.linear.listed = [issue("ANY-1"), issue("ANY-2"), issue("ANY-3")];
    await t.dispatcher.pollOnce();
    expect(t.created).toHaveLength(2);
    expect(t.dispatcher.waiting.map((w) => w.issue)).toEqual(["ANY-3"]);
    // Both agents are still running: nothing more starts.
    await t.dispatcher.pollOnce();
    expect(t.created).toHaveLength(2);
    // One finishes (idle): a slot opens.
    t.agents[0].status = "idle";
    await t.dispatcher.pollOnce();
    expect(t.created).toHaveLength(3);
    expect(t.dispatcher.waiting).toEqual([]);
  });

  it("treats 0 as no limit", async () => {
    const t = setup({ settings: { maxConcurrent: 0 } });
    t.linear.listed = Array.from({ length: 6 }, (_, i) => issue(`ANY-${i + 1}`));
    await t.dispatcher.pollOnce();
    expect(t.created).toHaveLength(6);
  });

  it("records a failed start and does not retry it by itself", async () => {
    const t = setup();
    t.linear.listed = [issue("ANY-1")];
    const original = t.dispatcher as any;
    const deps = original.deps;
    const spy = deps.paseo;
    deps.paseo = () => ({ ...spy(), workspaces: { create: async () => { throw new Error("no disk space"); } } });
    await t.dispatcher.pollOnce();
    expect(t.ledger.get("ANY-1")).toMatchObject({ status: "failed", error: "no disk space" });
    expect(t.dispatcher.lastPollError).toMatch(/ANY-1: no disk space/);
    deps.paseo = spy;
    await t.dispatcher.pollOnce();
    expect(t.created).toEqual([]);
  });

  it("reports a missing project without recording the ticket", async () => {
    const t = setup({ config: { config: { provider: "claude", teams: { ANY: { project: "Nope", states: ["unstarted"], roles: {} } } }, error: null } });
    t.linear.listed = [issue("ANY-1")];
    await t.dispatcher.pollOnce();
    expect(t.dispatcher.lastPollError).toMatch(/no project "Nope"/);
    expect(t.ledger.has("ANY-1")).toBe(false);
  });

  it("ignores teams the config does not map and waits for the Paseo API", async () => {
    const none = setup({ config: { config: EMPTY_CONFIG, error: null } });
    none.linear.listed = [issue("ANY-1")];
    await none.dispatcher.pollOnce();
    expect(none.created).toEqual([]);
    const noApi = setup({ hasPaseo: false });
    await noApi.dispatcher.pollOnce();
    expect(noApi.dispatcher.lastPollError).toMatch(/not available/);
  });

  it("does not run two polls at once", async () => {
    const t = setup();
    t.linear.listed = [issue("ANY-1")];
    await Promise.all([t.dispatcher.pollOnce(), t.dispatcher.pollOnce()]);
    expect(t.created).toHaveLength(1);
  });
});

describe("start (manual)", () => {
  it("starts an agent on any visible ticket, ignoring label, state and limit", async () => {
    const t = setup({ settings: { maxConcurrent: 1 } });
    t.linear.add("ANY-9", "Done");
    const out = await t.dispatcher.start("any-9");
    expect(out.agentId).toBe("agent-1");
    expect(t.ledger.get("ANY-9")).toMatchObject({ mode: "manual", status: "started" });
  });

  it("refuses while the ticket's agent is still running, allows it afterwards", async () => {
    const t = setup();
    t.linear.add("ANY-9", "Todo");
    await t.dispatcher.start("ANY-9");
    await expect(t.dispatcher.start("ANY-9")).rejects.toThrow(/already has a running agent/);
    t.agents[0].status = "idle";
    await expect(t.dispatcher.start("ANY-9")).resolves.toMatchObject({ agentId: "agent-2" });
  });

  it("refuses a ticket being started, an unknown ticket and an unmapped team", async () => {
    const t = setup();
    t.ledger.put({ issue: "ANY-1", title: null, mode: "auto", status: "starting", at: Date.now(), agentId: null, workspaceId: null, error: null });
    t.linear.add("ANY-1", "Todo");
    await expect(t.dispatcher.start("ANY-1")).rejects.toThrow(/being started/);
    await expect(t.dispatcher.start("ANY-404")).rejects.toThrow(/No ticket ANY-404/);
    t.linear.add("OPS-1", "Todo");
    await expect(t.dispatcher.start("OPS-1")).rejects.toThrow(/No project is configured for team OPS/);
  });
});

describe("status", () => {
  it("shows teams with whether their project exists, the ledger and the running count", async () => {
    const t = setup({ config: { config: { provider: "claude", teams: { ANY: { project: "Monorepo", states: ["unstarted"], roles: {} }, GONE: { project: "Nope", states: ["unstarted"], roles: {} } } }, error: null } });
    t.linear.add("ANY-9", "Todo");
    await t.dispatcher.start("ANY-9");
    const s = await t.dispatcher.status(t.settings, { configured: true, syncedAt: 5 });
    expect(s.teams).toEqual([
      { team: "ANY", project: "Monorepo", projectFound: true, label: "paseo", states: ["unstarted"] },
      { team: "GONE", project: "Nope", projectFound: false, label: "paseo", states: ["unstarted"] },
    ]);
    expect(s.running).toBe(1);
    expect(s.dispatched[0]).toMatchObject({ issue: "ANY-9", active: true });
  });
});
