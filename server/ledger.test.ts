import { statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Ledger } from "./ledger";
import { tmp } from "./testing";

const entry = (issue: string, at: number) => ({ issue, title: null, mode: "auto" as const, status: "starting" as const, at, agentId: null, workspaceId: null, error: null });

describe("Ledger", () => {
  it("persists entries mode 0600, newest first, and updates them", () => {
    const file = path.join(tmp(), "d.json");
    const ledger = new Ledger(file);
    ledger.put(entry("ANY-1", 1));
    ledger.put(entry("ANY-2", 2));
    ledger.update("ANY-1", { status: "started", agentId: "a" });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const again = new Ledger(file);
    expect(again.list().map((e) => e.issue)).toEqual(["ANY-2", "ANY-1"]);
    expect(again.get("ANY-1")).toMatchObject({ status: "started", agentId: "a" });
    expect(again.has("ANY-3")).toBe(false);
    ledger.update("NOPE-1", { status: "failed" });
    expect(ledger.has("NOPE-1")).toBe(false);
  });
});
