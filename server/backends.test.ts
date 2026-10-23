import path from "node:path";
import { describe, expect, it } from "vitest";
import type { BackendId } from "../shared/backends";
import type { Issue, TicketBackend } from "./backend";
import { NoKeyError } from "./backend";
import { BACKENDS, RoutedBackend, type BackendDef } from "./backends";
import { KeyStore } from "./keys";
import { FakeLinear, tmp } from "./testing";

function setup() {
  const keys = new KeyStore(path.join(tmp(), "keys.json"));
  const linear = new FakeLinear();
  linear.add("ANY-1", "Todo");
  const other = new FakeLinear([], {});
  const other2: TicketBackend & { calls: string[] } = Object.assign(Object.create(other), {
    calls: [] as string[],
    async issue(key: string): Promise<Issue | null> {
      this.calls.push(key);
      return key === "PRJ-5" ? ({ ...(await linear.issue("ANY-1"))!, identifier: "PRJ-5", backend: "other" as BackendId } as Issue) : null;
    },
  });
  const defs = {
    linear: { ...BACKENDS.linear, create: () => linear },
    other: { id: "other", label: "Other", icon: "Box", parseKey: (v: string) => (/^PRJ-\d+$/.test(v.toUpperCase()) ? v.toUpperCase() : null), create: () => other2 },
  } as unknown as Record<string, BackendDef>;
  return { keys, linear, other2, router: new RoutedBackend(keys, defs) };
}

describe("RoutedBackend", () => {
  it("offers every registered backend to the screen", () => {
    expect(setup().router.info().map((b) => b.label)).toEqual(["Linear", "Other"]);
    expect(new RoutedBackend(new KeyStore(path.join(tmp(), "k.json"))).info()).toEqual([{ id: "linear", label: "Linear", icon: "CircleDot" }]);
  });

  it("fails without any connection", async () => {
    await expect(setup().router.issue("ANY-1")).rejects.toBeInstanceOf(NoKeyError);
  });

  it("asks only backends that have a connection and accept the key", async () => {
    const { keys, router, other2 } = setup();
    keys.set("linear", "acme", "k");
    expect((await router.issue("ANY-1"))?.identifier).toBe("ANY-1");
    expect(other2.calls).toEqual([]);
    keys.set("other" as never, "prj", "k");
    expect((await router.issue("PRJ-5"))?.backend).toBe("other");
    expect(other2.calls).toEqual(["PRJ-5"]);
  });

  it("sends later calls to the issue's own backend", async () => {
    const { keys, router, linear } = setup();
    keys.set("linear", "acme", "k");
    const issue = (await router.issue("ANY-1"))!;
    await router.comment(issue, "hi");
    expect(linear.comments).toHaveLength(1);
  });

  it("accepts a ticket reference any backend recognizes", () => {
    const { router } = setup();
    expect(router.parseKey("any-1")).toBe("ANY-1");
    expect(router.parseKey("prj-5")).toBe("PRJ-5");
    expect(router.parseKey("nope")).toBeNull();
  });

  it("refuses to validate with an unknown backend", () => {
    expect(() => setup().router.validate("jira" as never, "k")).toThrow(/Unknown ticket backend/);
  });
});
