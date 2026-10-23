import { describe, expect, it } from "vitest";
import { boundIssue, parseIssueKey } from "./plugin";

describe("parseIssueKey", () => {
  it("normalizes case and whitespace", () => expect(parseIssueKey(" any-1234 ")).toBe("ANY-1234"));
  it.each(["", "ANY", "1234", "ANY-", "ANY-12x", "A NY-1", "https://linear.app/x/issue/ANY-1"])("rejects %j", (v) => expect(parseIssueKey(v)).toBeNull());
});

describe("boundIssue", () => {
  it("is undefined without the variable or with an empty one", () => {
    expect(boundIssue(undefined)).toBeUndefined();
    expect(boundIssue({})).toBeUndefined();
    expect(boundIssue({ PASEO_LINEAR_ISSUE: " " })).toBeUndefined();
  });
  it("returns the key", () => expect(boundIssue({ PASEO_LINEAR_ISSUE: "any-7" })).toBe("ANY-7"));
  it("throws on a malformed value instead of silently leaving the agent unbound", () => {
    expect(() => boundIssue({ PASEO_LINEAR_ISSUE: "nope" })).toThrow(/not a Linear issue key/);
  });
});
