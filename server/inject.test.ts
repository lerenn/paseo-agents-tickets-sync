import { describe, expect, it } from "vitest";
import { CAPABILITY_ENV, injectLinear, SERVER_NAME, URL_ENV } from "./inject";
import { TOOL_NAMES } from "./tools";

const req = { config: { provider: "claude", cwd: "/w", systemPrompt: "Be brief.", mcpServers: { other: { type: "http" as const, url: "http://x" } } }, env: { FOO: "1" } };

describe("injectLinear", () => {
  const out = injectLinear(req as never, { url: "http://127.0.0.1:1", capability: "cap", issue: "ANY-1" });

  it("adds the MCP server with the capability and keeps the others", () => {
    expect(out.config.mcpServers?.other).toBeDefined();
    expect(out.config.mcpServers?.[SERVER_NAME]).toMatchObject({ url: "http://127.0.0.1:1/mcp", headers: { authorization: "Bearer cap" } });
  });

  it("pre-approves exactly the Linear tools", () => {
    expect(out.config.toolPolicy?.preapproved).toEqual(TOOL_NAMES.map((tool) => ({ kind: "mcp", server: SERVER_NAME, tool })));
  });

  it("sets the environment and appends to the system prompt", () => {
    expect(out.env).toMatchObject({ FOO: "1", PASEO_LINEAR_ISSUE: "ANY-1", [URL_ENV]: "http://127.0.0.1:1", [CAPABILITY_ENV]: "cap" });
    expect(out.config.systemPrompt).toMatch(/^Be brief\.\n\nLinear: you are bound to ticket ANY-1/);
  });

  it("does not mutate the request", () => {
    expect(req.config.mcpServers).not.toHaveProperty(SERVER_NAME);
  });
});
