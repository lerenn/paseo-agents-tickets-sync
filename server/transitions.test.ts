import { describe, expect, it } from "vitest";
import { rank } from "./transitions";
import { setup, STATES } from "./testing";

const EVIDENCE = "npm test: 42 passed; PR #7 merged";

describe("rank", () => {
  it("ranks by name before type, so Ready To Release is not closed", () => {
    expect(rank({ name: "Ready To Release", type: "completed" })).toBeLessThan(rank({ name: "Done", type: "completed" }));
  });
  it("falls back to the type for unknown names", () => {
    expect(rank({ name: "Shipped", type: "completed" })).toBe(rank({ name: "Done", type: "completed" }));
    expect(rank({ name: "Doing", type: "started" })).toBe(rank({ name: "In Progress", type: "started" }));
  });
});

describe("start", () => {
  it("moves a Todo ticket to In Progress", async () => {
    const { linear, transitions } = setup();
    linear.add("ANY-1", "Todo");
    const out = await transitions.start("ANY-1", "a1");
    expect(out).toMatchObject({ ok: true, applied: true });
    expect(linear.stateOf("ANY-1")).toBe("In Progress");
  });

  it.each(["In Progress", "In Review", "Ready To Release", "Done", "Canceled"])("leaves a ticket already %s alone", async (state) => {
    const { linear, transitions } = setup();
    linear.add("ANY-1", state);
    const out = await transitions.start("ANY-1", "a1");
    expect(out).toMatchObject({ ok: true, applied: false });
    expect(linear.moves).toEqual([]);
  });

  it("moves a Blocked ticket back to In Progress when work resumes", async () => {
    const { linear, transitions } = setup();
    linear.add("ANY-1", "Blocked");
    await transitions.start("ANY-1", "a1");
    expect(linear.stateOf("ANY-1")).toBe("In Progress");
  });

  it("is idempotent", async () => {
    const { linear, transitions } = setup();
    linear.add("ANY-1", "Todo");
    await Promise.all([transitions.start("ANY-1", "a1"), transitions.start("ANY-1", "a2")]);
    expect(linear.moves).toHaveLength(1);
  });

  it("maps a team's own state names by type", async () => {
    const { linear, transitions } = setup([
      { id: "t", name: "Open", type: "unstarted", position: 0 },
      { id: "d", name: "Doing", type: "started", position: 1 },
      { id: "x", name: "Shipped", type: "completed", position: 2 },
    ]);
    linear.add("ANY-1", "Open");
    await transitions.start("ANY-1", null);
    expect(linear.stateOf("ANY-1")).toBe("Doing");
  });

  it("fails clearly for a ticket Linear does not show", async () => {
    const { transitions, audit } = setup();
    const out = await transitions.start("ANY-9", "a1");
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/ANY-9/);
    expect(audit.recent()[0]).toMatchObject({ kind: "start", outcome: "failed", issue: "ANY-9" });
  });

  it("reports a Linear outage as a failure, not a throw", async () => {
    const { linear, transitions } = setup();
    linear.add("ANY-1", "Todo");
    linear.failSetState = true;
    expect(await transitions.start("ANY-1", "a1")).toMatchObject({ ok: false, message: "Linear is down" });
  });
});

describe("comment", () => {
  it("posts with the Paseo prefix, once", async () => {
    const { linear, transitions } = setup();
    linear.add("ANY-1", "In Progress");
    expect((await transitions.comment("ANY-1", "a1", "Plan agreed")).applied).toBe(true);
    expect((await transitions.comment("ANY-1", "a1", "Plan agreed")).applied).toBe(false);
    expect(linear.comments).toEqual([{ key: "ANY-1", body: "[Paseo] Plan agreed" }]);
  });

  it("does not change the status", async () => {
    const { linear, transitions } = setup();
    linear.add("ANY-1", "Todo");
    await transitions.comment("ANY-1", "a1", "hello");
    expect(linear.stateOf("ANY-1")).toBe("Todo");
  });

  it("rejects an empty comment", async () => {
    const { linear, transitions } = setup();
    linear.add("ANY-1", "Todo");
    expect((await transitions.comment("ANY-1", "a1", "   ")).ok).toBe(false);
    expect(linear.comments).toEqual([]);
  });
});

describe("done", () => {
  it("needs evidence and changes nothing without it", async () => {
    const { linear, transitions } = setup();
    linear.add("ANY-1", "In Progress");
    const out = await transitions.done("ANY-1", "a1", "done");
    expect(out.ok).toBe(false);
    expect(linear.comments).toEqual([]);
    expect(linear.stateOf("ANY-1")).toBe("In Progress");
  });

  it.each(["In Progress", "In Review", "Ready To Release"])("moves a ticket in %s to Done with the evidence", async (state) => {
    const { linear, transitions } = setup();
    linear.add("ANY-1", state);
    const out = await transitions.done("ANY-1", "a1", EVIDENCE);
    expect(out).toMatchObject({ ok: true, applied: true });
    expect(linear.stateOf("ANY-1")).toBe("Done");
    expect(linear.comments[0].body).toBe(`[Paseo] Done. Verification: ${EVIDENCE}`);
  });

  it("is idempotent once Done", async () => {
    const { linear, transitions } = setup();
    linear.add("ANY-1", "In Progress");
    await transitions.done("ANY-1", "a1", EVIDENCE);
    const again = await transitions.done("ANY-1", "a1", EVIDENCE);
    expect(again).toMatchObject({ ok: true, applied: false });
    expect(linear.comments).toHaveLength(1);
    expect(linear.moves).toHaveLength(1);
  });

  it("never touches a canceled ticket", async () => {
    const { linear, transitions } = setup();
    linear.add("ANY-1", "Canceled");
    expect(await transitions.done("ANY-1", "a1", EVIDENCE)).toMatchObject({ ok: true, applied: false });
    expect(linear.comments).toEqual([]);
    expect(linear.stateOf("ANY-1")).toBe("Canceled");
  });

  it("retries the status without repeating the comment when the move failed", async () => {
    const { linear, transitions } = setup();
    linear.add("ANY-1", "In Progress");
    linear.failSetState = true;
    expect((await transitions.done("ANY-1", "a1", EVIDENCE)).ok).toBe(false);
    linear.failSetState = false;
    expect((await transitions.done("ANY-1", "a1", EVIDENCE)).ok).toBe(true);
    expect(linear.comments).toHaveLength(1);
    expect(linear.stateOf("ANY-1")).toBe("Done");
  });

  it("leaves the status when the comment cannot be posted", async () => {
    const { linear, transitions } = setup();
    linear.add("ANY-1", "In Progress");
    linear.failComment = true;
    expect((await transitions.done("ANY-1", "a1", EVIDENCE)).ok).toBe(false);
    expect(linear.stateOf("ANY-1")).toBe("In Progress");
  });
});

describe("blocked", () => {
  it("posts the reason and moves to Blocked", async () => {
    const { linear, transitions } = setup();
    linear.add("ANY-1", "In Progress");
    await transitions.blocked("ANY-1", "a1", "Waiting for the API key");
    expect(linear.stateOf("ANY-1")).toBe("Blocked");
    expect(linear.comments[0].body).toBe("[Paseo] Blocked: Waiting for the API key");
  });

  it("only comments when the team has no Blocked state", async () => {
    const { linear, transitions } = setup(STATES.filter((s) => s.name !== "Blocked"));
    linear.add("ANY-1", "In Progress");
    const out = await transitions.blocked("ANY-1", "a1", "Waiting for the API key");
    expect(out.ok).toBe(true);
    expect(linear.stateOf("ANY-1")).toBe("In Progress");
    expect(linear.comments).toHaveLength(1);
  });

  it("does not reopen a Done ticket", async () => {
    const { linear, transitions } = setup();
    linear.add("ANY-1", "Done");
    expect(await transitions.blocked("ANY-1", "a1", "why")).toMatchObject({ applied: false });
    expect(linear.comments).toEqual([]);
  });

  it("requires a reason", async () => {
    const { linear, transitions } = setup();
    linear.add("ANY-1", "Todo");
    expect((await transitions.blocked("ANY-1", "a1", " ")).ok).toBe(false);
  });
});

describe("audit", () => {
  it("records applied, skipped and failed attempts, newest first", async () => {
    const { linear, transitions, audit } = setup();
    linear.add("ANY-1", "Todo");
    await transitions.start("ANY-1", "a1");
    await transitions.start("ANY-1", "a1");
    await transitions.start("ANY-2", "a1");
    expect(audit.recent().map((e) => e.outcome)).toEqual(["failed", "skipped", "applied"]);
    expect(audit.recent()[2]).toMatchObject({ from: "Todo", to: "In Progress", agentId: "a1" });
  });
});
