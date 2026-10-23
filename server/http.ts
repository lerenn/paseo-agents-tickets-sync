import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { BindingStore } from "./bindings";
import type { McpServer } from "./mcp";
import type { Transitions } from "./transitions";

const MAX_BODY = 1_000_000;

/** Local MCP endpoint agents reach at `/mcp`. Bound to loopback and guarded by a per-agent capability. */
export class LinearHttp {
  private server: Server | null = null;

  constructor(private readonly deps: { bindings: BindingStore; mcp: McpServer; transitions: Transitions }) {}

  /** Resolves with the base URL. Rejects if the port is taken. */
  start(port: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        this.route(req).then(
          ({ status, body }) => {
            res.writeHead(status, { "content-type": "application/json" });
            res.end(body === null ? undefined : JSON.stringify(body));
          },
          (err) => {
            res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: String(err?.message ?? err) }));
          },
        );
      });
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        this.server = server;
        server.off("error", reject);
        resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  private async route(req: IncomingMessage): Promise<{ status: number; body: unknown }> {
    const host = req.headers.host ?? "";
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return { status: 403, body: { error: "forbidden host" } };
    if ((req.url ?? "").split("?")[0] !== "/mcp") return { status: 404, body: { error: "not found" } };
    if (req.method !== "POST") return { status: 405, body: { error: "POST only" } };

    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    const binding = this.deps.bindings.resolve(bearer);
    if (!binding) return { status: 401, body: { error: "unknown or expired capability; recreate the agent" } };

    let payload: unknown;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (err) {
      return { status: 400, body: { error: (err as Error).message } };
    }
    const reply = await this.deps.mcp.handle(payload, {
      issue: binding.issue,
      agentId: binding.agentId ?? null,
      transitions: this.deps.transitions,
    });
    return reply ? { status: 200, body: reply } : { status: 202, body: null };
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("request body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
