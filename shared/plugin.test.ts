import { describe, expect, it } from "vitest";
import { boundTicket, parseLinearKey, ticketRef } from "./plugin";

describe("parseLinearKey", () => {
  it("normalizes case and whitespace", () => expect(parseLinearKey(" any-1234 ")).toBe("ANY-1234"));
  it.each(["", "ANY", "1234", "ANY-", "ANY-12x", "A NY-1", "https://linear.app/x/issue/ANY-1"])("rejects %j", (v) => expect(parseLinearKey(v)).toBeNull());
});

describe("ticketRef", () => {
  it("reads PASEO_AGENT_TICKET, else the PASEO_LINEAR_ISSUE alias", () => {
    expect(ticketRef({ PASEO_AGENT_TICKET: "ANY-1" })).toBe("ANY-1");
    expect(ticketRef({ PASEO_LINEAR_ISSUE: "ANY-2" })).toBe("ANY-2");
    expect(ticketRef({})).toBeUndefined();
  });
  it("accepts both when they name the same ticket", () => {
    expect(ticketRef({ PASEO_AGENT_TICKET: "ANY-1", PASEO_LINEAR_ISSUE: "any-1" })).toBe("ANY-1");
  });
  it("refuses two different tickets", () => {
    expect(() => ticketRef({ PASEO_AGENT_TICKET: "ANY-1", PASEO_LINEAR_ISSUE: "ANY-2" })).toThrow(/different tickets/);
  });
});

describe("boundTicket", () => {
  it("is undefined without the variable or with an empty one", () => {
    expect(boundTicket(undefined, parseLinearKey)).toBeUndefined();
    expect(boundTicket({}, parseLinearKey)).toBeUndefined();
    expect(boundTicket({ PASEO_AGENT_TICKET: " " }, parseLinearKey)).toBeUndefined();
  });
  it("returns the normalized key, from either variable", () => {
    expect(boundTicket({ PASEO_AGENT_TICKET: "any-7" }, parseLinearKey)).toBe("ANY-7");
    expect(boundTicket({ PASEO_LINEAR_ISSUE: "any-8" }, parseLinearKey)).toBe("ANY-8");
  });
  it("throws on a malformed value instead of silently leaving the agent unbound", () => {
    expect(() => boundTicket({ PASEO_AGENT_TICKET: "nope" }, parseLinearKey)).toThrow(/not a valid ticket key/);
  });
});
