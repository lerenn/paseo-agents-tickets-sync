import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const realFetch = fetch;
type Handler = (input: any, ctx?: any) => any;
const before = new Map<string, Handler>();
const on = new Map<string, Handler>();
const rpcs = new Map<string, Handler>();
let backendSetting = "linear";
let cleanup: () => Promise<void> | void;
let home: string;

const states = [
  { id: "s-todo", name: "Todo", type: "unstarted", position: 1 },
  { id: "s-prog", name: "In Progress", type: "started", position: 2 },
  { id: "s-done", name: "Done", type: "completed", position: 5 },
];
let current = "Todo";
const writes: string[] = [];

// Fake Linear over fetch: one ticket, ANY-1.
const fakeFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
  const { query, variables } = JSON.parse(String(init?.body));
  const data = (d: unknown) => new Response(JSON.stringify({ data: d }));
  if (query.includes("viewer")) return data({ viewer: { name: "Ada", organization: { urlKey: "acme" } } });
  if (query.includes("issueUpdate")) {
    current = states.find((s) => s.id === variables.stateId)!.name;
    writes.push(`state:${current}`);
    return data({ issueUpdate: { success: true } });
  }
  if (query.includes("commentCreate")) {
    writes.push(`comment:${variables.body}`);
    return data({ commentCreate: { success: true } });
  }
  if (query.includes("team(")) return data({ team: { states: { nodes: states } } });
  const s = states.find((x) => x.name === current)!;
  return data({ issue: { id: "i1", identifier: "ANY-1", title: "T", url: "u", state: { id: s.id, name: s.name, type: s.type }, team: { id: "t", key: "ANY" } } });
});

beforeAll(async () => {
  // Not ./server/testing: importing it would load the stores before HOME is stubbed.
  home = mkdtempSync(path.join(tmpdir(), "lin-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("AGENT_TICKETS_PORT", "0");
  vi.stubGlobal("fetch", fakeFetch);
  const { default: contribute } = await import("./index.server");
  cleanup = contribute({
    before: (name: string, h: Handler) => (before.set(name, h), () => before.delete(name)),
    on: (name: string, h: Handler) => (on.set(name, h), () => on.delete(name)),
    registerSettings: () => ({
      read: async () => ({ status: "ready", revision: "1", values: { backend: backendSetting } }),
      subscribe: () => () => {},
    }),
    handle: (contract: { name: string }, h: Handler) => void rpcs.set(contract.name, h),
  } as never) as () => Promise<void>;
});
afterAll(async () => {
  await cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const create = (env?: Record<string, string>) => before.get("agent.create")!({ request: { config: { provider: "claude", cwd: "/work" }, env } }, {});
const open = (env: Record<string, string>, extra = {}) =>
  before.get("agent.session_open")!({ request: { agentId: "agent-1", workspaceId: null, provider: "claude", cwd: "/work", reason: "create", purpose: "interactive", env, ...extra } }, {});
const settle = () => new Promise((r) => setTimeout(r, 50));

describe("plugin wiring", () => {
  it("leaves unbound agents untouched", async () => {
    expect(await create()).toBeUndefined();
    expect(await create({ FOO: "1" })).toBeUndefined();
    expect(await create({ PASEO_AGENT_TICKET: "" })).toBeUndefined();
  });

  it("honors the PASEO_LINEAR_ISSUE alias and refuses conflicting variables", async () => {
    const out = await create({ PASEO_LINEAR_ISSUE: "any-1" });
    expect(out.env.PASEO_AGENT_TICKET).toBe("ANY-1");
    await expect(create({ PASEO_AGENT_TICKET: "ANY-1", PASEO_LINEAR_ISSUE: "ANY-2" })).rejects.toThrow(/different tickets/);
  });

  it("falls back to Linear when the backend setting is unreadable or unknown", async () => {
    backendSetting = "jira";
    try {
      expect((await create({ PASEO_AGENT_TICKET: "ANY-1" })).env.PASEO_AGENT_TICKET).toBe("ANY-1");
    } finally {
      backendSetting = "linear";
    }
  });

  it("refuses a malformed ticket key", async () => {
    await expect(create({ PASEO_AGENT_TICKET: "banana" })).rejects.toThrow(/not a valid ticket key/);
  });

  let capability = "";
  it("binds an agent created with PASEO_AGENT_TICKET and injects the MCP server", async () => {
    const out = await create({ PASEO_AGENT_TICKET: "any-1" });
    expect(out.config.mcpServers["paseo-agent-tickets"].url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(out.env.PASEO_AGENT_TICKET).toBe("ANY-1");
    capability = out.env.PASEO_AGENT_TICKETS_CAPABILITY;
    expect(capability).toBeTruthy();
  });

  it("keeps the API key write-only and 0600", async () => {
    const out = await rpcs.get("agent-tickets.set-key")!({ name: "Acme", key: "lin_api_secret" });
    expect(out).toEqual({ scope: "acme", user: "Ada" });
    const file = path.join(home, ".paseo", "plugin-data", "agent-tickets", "keys.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("moves the ticket to In Progress when the agent's session opens, once", async () => {
    await open({ PASEO_AGENT_TICKETS_CAPABILITY: capability });
    await settle();
    expect(current).toBe("In Progress");
    // A resume does not repeat the move.
    await open({ PASEO_AGENT_TICKETS_CAPABILITY: capability }, { reason: "resume" });
    await settle();
    expect(writes.filter((w) => w.startsWith("state:"))).toEqual(["state:In Progress"]);
    const status = await rpcs.get("agent-tickets.status")!({});
    expect(status.agents[0]).toMatchObject({ agentId: "agent-1", issue: "ANY-1", started: true, state: "In Progress" });
    expect(status.backend).toBe("Linear");
    expect(status.workspaces).toEqual([{ name: "acme", scope: "acme" }]);
    expect(JSON.stringify(status)).not.toContain("lin_api_secret");
  });

  it("ignores history sessions and sessions without a capability", async () => {
    before.get("agent.session_open")!({ request: { agentId: "x", purpose: "history", env: { PASEO_AGENT_TICKETS_CAPABILITY: capability } } }, {});
    before.get("agent.session_open")!({ request: { agentId: "x", purpose: "interactive", env: {} } }, {});
    await settle();
    expect(writes).toHaveLength(1);
  });

  it("serves the MCP tools through the injected endpoint", async () => {
    const out = await create({ PASEO_AGENT_TICKET: "ANY-1" });
    const { url, headers } = out.config.mcpServers["paseo-agent-tickets"];
    const res = await realFetch(url, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ticket_done", arguments: { evidence: "all checks green; PR #1 merged" } } }),
    });
    expect(((await res.json()) as any).result.isError).toBeUndefined();
    expect(current).toBe("Done");
    expect(writes).toContain("comment:[Paseo] Done. Verification: all checks green; PR #1 merged");
  });

  it("keeps an archived agent's binding visible", async () => {
    await on.get("agent.archived")!({ agent: { id: "agent-1" }, archivedAt: "now" }, {});
    const status = await rpcs.get("agent-tickets.status")!({});
    expect(status.agents.find((a: any) => a.agentId === "agent-1").archived).toBe(true);
  });

  it("clears a key", async () => {
    await rpcs.get("agent-tickets.clear-key")!({ name: "acme" });
    expect((await rpcs.get("agent-tickets.status")!({})).workspaces).toEqual([]);
  });
});
