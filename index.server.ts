import type { PluginServerContext } from "@getpaseo/plugin/server";
import { AuditLog } from "./server/audit";
import { BindingStore } from "./server/bindings";
import { LinearHttp } from "./server/http";
import { CAPABILITY_ENV, injectLinear } from "./server/inject";
import { KeyStore } from "./server/keys";
import { LinearClient } from "./server/linear";
import { McpServer } from "./server/mcp";
import { LinearService } from "./server/service";
import { TOOLS } from "./server/tools";
import { Transitions } from "./server/transitions";
import { boundIssue } from "./shared/plugin";
import { auditRpc, clearKeyRpc, setKeyRpc, statusRpc } from "./shared/rpc";

const DEFAULT_PORT = 47823;

export default function contribute(server: PluginServerContext) {
  const keys = new KeyStore();
  const audit = new AuditLog();
  const bindings = new BindingStore();
  const client = new LinearClient(keys);
  const transitions = new Transitions(client, audit);
  const http = new LinearHttp({ bindings, mcp: new McpServer(TOOLS), transitions });

  let url: string | null = null;
  let startError: string | null = null;
  const service = new LinearService(keys, bindings, client, client, () => ({ url, error: startError }));

  // Resumed agents keep the URL they were created with, so the port has to be stable.
  const port = Number(process.env.LINEAR_PLUGIN_PORT ?? DEFAULT_PORT);
  const started = http.start(port).then(
    (u) => {
      url = u;
    },
    (err: Error) => {
      startError = `linear cannot listen on 127.0.0.1:${port}: ${err.message}. Set LINEAR_PLUGIN_PORT on the daemon.`;
      console.error(startError);
    },
  );

  const removeCreate = server.before("agent.create", async ({ request }) => {
    // Throws on a malformed value: better a refused agent than one silently unbound.
    const issue = boundIssue(request.env);
    if (!issue) return;
    await started;
    if (!url) throw new Error(`${startError} Create the agent without PASEO_LINEAR_ISSUE to skip Linear.`);
    return injectLinear(request, { url, capability: bindings.create(issue, request.config.cwd), issue });
  });

  // The session opens after the agent exists, so this is where the capability learns its agent and
  // where "agent start" happens. Resumes retry a start that did not land; the move is forward-only.
  const removeOpen = server.before("agent.session_open", ({ request }) => {
    const capability = request.env[CAPABILITY_ENV];
    if (!capability || request.purpose !== "interactive") return;
    const binding = bindings.bind(capability, request.agentId);
    if (!binding || binding.started) return;
    void transitions.start(binding.issue, request.agentId).then((outcome) => {
      if (outcome.ok) bindings.markStarted(request.agentId);
    });
  });
  const removeArchived = server.on("agent.archived", ({ agent }) => bindings.archive(agent.id));

  server.handle(statusRpc, () => service.status());
  server.handle(auditRpc, ({ limit }) => ({ entries: audit.recent(limit) }));
  server.handle(setKeyRpc, ({ name, key }) => service.setKey(name, key));
  server.handle(clearKeyRpc, ({ name }) => {
    service.clearKey(name);
    return {};
  });

  return async () => {
    removeCreate();
    removeOpen();
    removeArchived();
    await http.stop();
  };
}
