import { request } from "node:http";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BindingStore } from "./bindings";
import { LinearHttp } from "./http";
import { McpServer } from "./mcp";
import { setup, tmp } from "./testing";
import { TOOLS } from "./tools";

let url: string;
let token: string;
let http: LinearHttp;
const s = setup();

beforeAll(async () => {
  s.linear.add("ANY-1", "Todo");
  const bindings = new BindingStore(path.join(tmp(), "b.json"));
  token = bindings.create("ANY-1", "/w");
  bindings.bind(token, "agent-1");
  http = new LinearHttp({ bindings, mcp: new McpServer(TOOLS), transitions: s.transitions });
  url = await http.start(0);
});
afterAll(() => http.stop());

const post = (auth: string | null, body: unknown, p = "/mcp") =>
  fetch(url + p, { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) });

describe("LinearHttp", () => {
  it("serves MCP calls for a valid capability, attributed to the agent", async () => {
    const res = await post(token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "linear_comment", arguments: { text: "hi" } } });
    expect(res.status).toBe(200);
    expect(s.linear.comments).toEqual([{ key: "ANY-1", body: "[Paseo] hi" }]);
    expect(s.audit.recent()[0]).toMatchObject({ agentId: "agent-1", kind: "comment" });
  });

  it("answers notifications with 202", async () => {
    expect((await post(token, { jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
  });

  it("refuses a missing or unknown capability", async () => {
    expect((await post(null, {})).status).toBe(401);
    expect((await post("wrong", {})).status).toBe(401);
  });

  it("refuses other paths, methods and hosts", async () => {
    expect((await post(token, {}, "/other")).status).toBe(404);
    expect((await fetch(url + "/mcp")).status).toBe(405);
    expect(await statusWithHost("evil.example")).toBe(403);
  });
});

function statusWithHost(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = request({ host: u.hostname, port: u.port, path: "/mcp", method: "POST", headers: { host, authorization: `Bearer ${token}` } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end("{}");
  });
}
