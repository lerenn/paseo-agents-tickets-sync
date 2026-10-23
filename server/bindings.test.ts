import { statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BindingStore } from "./bindings";
import { tmp } from "./testing";

describe("BindingStore", () => {
  it("resolves a capability to its ticket, mode 0600, and persists", () => {
    const file = path.join(tmp(), "b.json");
    const store = new BindingStore(file);
    const token = store.create("ANY-1", "/work");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(store.resolve(token)).toMatchObject({ issue: "ANY-1", cwd: "/work" });
    expect(new BindingStore(file).resolve(token)?.issue).toBe("ANY-1");
  });

  it("rejects unknown, empty and near-miss tokens", () => {
    const store = new BindingStore(path.join(tmp(), "b.json"));
    const token = store.create("ANY-1", "/work");
    expect(store.resolve(undefined)).toBeNull();
    expect(store.resolve("")).toBeNull();
    expect(store.resolve(token.slice(0, -1))).toBeNull();
    expect(store.resolve(token + "x")).toBeNull();
  });

  it("binds an agent, marks it started, and keeps it archived for a week", () => {
    let now = 1_000;
    const file = path.join(tmp(), "b.json");
    const store = new BindingStore(file, () => now);
    const token = store.create("ANY-1", "/work");
    store.bind(token, "agent-1");
    store.markStarted("agent-1");
    expect(store.list()[0]).toMatchObject({ agentId: "agent-1", started: true });
    store.archive("agent-1");
    expect(store.list()[0].archivedAt).toBe(1_000);
    now += 8 * 24 * 3600 * 1000;
    expect(new BindingStore(file, () => now).list()).toEqual([]);
  });

  it("prunes capabilities never bound to an agent", () => {
    let now = 0;
    const file = path.join(tmp(), "b.json");
    new BindingStore(file, () => now).create("ANY-1", "/w");
    now = 8 * 24 * 3600 * 1000;
    expect(new BindingStore(file, () => now).list()).toEqual([]);
  });

  it("returns null when binding an unknown capability", () => {
    expect(new BindingStore(path.join(tmp(), "b.json")).bind("nope", "a")).toBeNull();
  });
});
