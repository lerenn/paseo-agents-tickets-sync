import type { PluginServerContext } from "@getpaseo/plugin/server";
import { SelectedBackend } from "./server/backends";
import { AuditLog } from "./server/audit";
import { BindingStore } from "./server/bindings";
import { TicketsHttp } from "./server/http";
import { CAPABILITY_ENV, injectTickets } from "./server/inject";
import { KeyStore } from "./server/keys";
import { McpServer } from "./server/mcp";
import { TicketService } from "./server/service";
import { TOOLS } from "./server/tools";
import { Transitions } from "./server/transitions";
import { boundTicket } from "./shared/plugin";
import { ticketSettings } from "./shared/settings";
import { auditRpc, clearKeyRpc, setKeyRpc, statusRpc } from "./shared/rpc";

const DEFAULT_PORT = 47823;

export default function contribute(server: PluginServerContext) {
  const keys = new KeyStore();
  const audit = new AuditLog();
  const bindings = new BindingStore();
  const settings = server.registerSettings(ticketSettings);
  const backend = new SelectedBackend(async () => {
    const state = await settings.read();
    return state.status === "ready" ? state.values.backend : ticketSettings.schema.parse({}).backend;
  }, { keys });
  const transitions = new Transitions(backend, audit);
  const http = new TicketsHttp({ bindings, mcp: new McpServer(TOOLS), transitions });

  let url: string | null = null;
  let startError: string | null = null;
  const service = new TicketService(keys, bindings, backend, async () => (await backend.current()).def.label, () => ({ url, error: startError }));

  // Resumed agents keep the URL they were created with, so the port has to be stable.
  const port = Number(process.env.AGENT_TICKETS_PORT ?? DEFAULT_PORT);
  const started = http.start(port).then(
    (u) => {
      url = u;
    },
    (err: Error) => {
      startError = `agent-tickets cannot listen on 127.0.0.1:${port}: ${err.message}. Set AGENT_TICKETS_PORT on the daemon.`;
      console.error(startError);
    },
  );

  const removeCreate = server.before("agent.create", async ({ request }) => {
    // Throws on a malformed value: better a refused agent than one silently unbound.
    const { def } = await backend.current();
    const issue = boundTicket(request.env, def.parseKey);
    if (!issue) return;
    await started;
    if (!url) throw new Error(`${startError} Create the agent without PASEO_AGENT_TICKET to skip tickets.`);
    return injectTickets(request, { url, capability: bindings.create(issue, request.config.cwd), issue });
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
