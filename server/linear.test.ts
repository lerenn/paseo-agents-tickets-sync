import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { KeyStore } from "./keys";
import { LinearClient, NoKeyError } from "./linear";
import { tmp } from "./testing";

const ISSUE = { id: "i1", identifier: "ANY-1", title: "T", url: "u", state: { id: "s", name: "Todo", type: "unstarted" }, team: { id: "t", key: "ANY" } };

function setup(handler: (auth: string, query: string, vars: any) => unknown | Response) {
  const keys = new KeyStore(path.join(tmp(), "k.json"));
  const calls: { auth: string; query: string }[] = [];
  const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const auth = (init?.headers as Record<string, string>).authorization;
    const { query, variables } = JSON.parse(String(init?.body));
    calls.push({ auth, query });
    const out = handler(auth, query, variables);
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200 });
  });
  return { keys, calls, client: new LinearClient(keys, { fetch: fetchFn as never }) };
}

describe("LinearClient", () => {
  it("sends the key as-is, with no Bearer prefix", async () => {
    const { keys, calls, client } = setup(() => ({ data: { issue: ISSUE } }));
    keys.set("acme", "lin_api_abc");
    expect(await client.issue("ANY-1")).toMatchObject({ identifier: "ANY-1", workspace: "acme" });
    expect(calls[0].auth).toBe("lin_api_abc");
  });

  it("tries each key until one sees the issue, then remembers the team prefix", async () => {
    const { keys, calls, client } = setup((auth) => (auth === "k-two" ? { data: { issue: ISSUE } } : { errors: [{ message: "Entity not found: Issue" }] }));
    keys.set("one", "k-one");
    keys.set("two", "k-two");
    expect((await client.issue("ANY-1"))?.workspace).toBe("two");
    calls.length = 0;
    await client.issue("ANY-2");
    expect(calls[0].auth).toBe("k-two");
  });

  it("returns null when no workspace has the issue", async () => {
    const { keys, client } = setup(() => ({ data: { issue: null } }));
    keys.set("one", "k");
    expect(await client.issue("ANY-9")).toBeNull();
  });

  it("fails clearly without keys and on a refused key", async () => {
    const none = setup(() => ({}));
    await expect(none.client.issue("ANY-1")).rejects.toBeInstanceOf(NoKeyError);
    const refused = setup(() => new Response("", { status: 401 }));
    refused.keys.set("one", "k");
    await expect(refused.client.issue("ANY-1")).rejects.toThrow(/refused the API key of workspace "one"/);
  });

  it("caches team states for an hour", async () => {
    let t = 0;
    const keys = new KeyStore(path.join(tmp(), "k.json"));
    keys.set("a", "k");
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ data: { team: { states: { nodes: [{ id: "x", name: "Todo", type: "unstarted", position: 0 }] } } } })));
    const client = new LinearClient(keys, { fetch: fetchFn as never, now: () => t });
    const issue = { ...ISSUE, workspace: "a", team: { id: "t", key: "ANY" } };
    await client.states(issue);
    await client.states(issue);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    t = 3_700_000;
    await client.states(issue);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("surfaces GraphQL errors and unsuccessful mutations", async () => {
    const { keys, client } = setup((_a, q) => (q.includes("issueUpdate") ? { data: { issueUpdate: { success: false } } } : { errors: [{ message: "boom" }] }));
    keys.set("a", "k");
    await expect(client.setState({ ...ISSUE, workspace: "a" }, "s")).rejects.toThrow(/did not apply/);
    await expect(client.comment({ ...ISSUE, workspace: "a" }, "b")).rejects.toThrow("boom");
  });

  it("whoami returns the organization", async () => {
    const { client } = setup(() => ({ data: { viewer: { name: "Ada", organization: { urlKey: "acme" } } } }));
    expect(await client.whoami("k")).toEqual({ org: "acme", user: "Ada" });
  });
});
