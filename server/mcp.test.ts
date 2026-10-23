import { describe, expect, it } from "vitest";
import { McpServer } from "./mcp";
import { setup } from "./testing";
import { TOOLS, type ToolContext } from "./tools";

function ctx() {
  const s = setup();
  s.linear.add("ANY-1", "In Progress");
  s.linear.add("ANY-2", "In Progress");
  const c: ToolContext = { issue: "ANY-1", agentId: "a1", transitions: s.transitions };
  return { ...s, c, mcp: new McpServer(TOOLS) };
}
const call = (mcp: McpServer, c: ToolContext, name: string, args: unknown) =>
  mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, c) as Promise<any>;

describe("MCP tools", () => {
  it("lists the four tools with JSON schemas, and none takes a ticket argument", async () => {
    const { mcp, c } = ctx();
    const res: any = await mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" }, c);
    expect(res.result.tools.map((t: any) => t.name)).toEqual(["ticket_status", "ticket_comment", "ticket_done", "ticket_blocked"]);
    for (const t of res.result.tools) expect(JSON.stringify(t.inputSchema)).not.toMatch(/issue|ticket/i);
  });

  it("answers initialize and ignores notifications", async () => {
    const { mcp, c } = ctx();
    expect(((await mcp.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, c)) as any).result.serverInfo.name).toBe("paseo-agents-tickets-sync");
    expect(await mcp.handle({ jsonrpc: "2.0", method: "notifications/initialized" }, c)).toBeNull();
  });

  it("ticket_comment posts on the bound ticket only", async () => {
    const { mcp, c, linear } = ctx();
    const res = await call(mcp, c, "ticket_comment", { text: "PR opened", issue: "ANY-2" });
    expect(res.result.isError).toBeUndefined();
    expect(linear.comments).toEqual([{ key: "ANY-1", body: "[Paseo] PR opened" }]);
  });

  it("ticket_done with evidence moves to Done; without it, an error and no change", async () => {
    const { mcp, c, linear } = ctx();
    const weak = await call(mcp, c, "ticket_done", { evidence: "ok" });
    expect(weak.result.isError).toBe(true);
    expect(linear.stateOf("ANY-1")).toBe("In Progress");
    const ok = await call(mcp, c, "ticket_done", { evidence: "go test ./... passed; PR #3 merged" });
    expect(ok.result.isError).toBeUndefined();
    expect(linear.stateOf("ANY-1")).toBe("Done");
    expect(linear.stateOf("ANY-2")).toBe("In Progress");
  });

  it("ticket_blocked moves to Blocked", async () => {
    const { mcp, c, linear } = ctx();
    await call(mcp, c, "ticket_blocked", { reason: "needs a decision from Louis" });
    expect(linear.stateOf("ANY-1")).toBe("Blocked");
  });

  it("ticket_status reads the ticket", async () => {
    const { mcp, c } = ctx();
    const res = await call(mcp, c, "ticket_status", {});
    expect(res.result.content[0].text).toContain('"state": "In Progress"');
  });

  it("returns a Linear failure to the agent as a tool error", async () => {
    const { mcp, c, linear } = ctx();
    linear.failComment = true;
    const res = await call(mcp, c, "ticket_comment", { text: "x" });
    expect(res.result).toMatchObject({ isError: true, content: [{ text: "Linear is down" }] });
  });

  it("rejects unknown tools", async () => {
    const { mcp, c } = ctx();
    expect((await call(mcp, c, "linear_delete", {})).error.code).toBe(-32602);
  });
});
