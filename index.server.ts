import type { PluginServerContext } from "@getpaseo/plugin/server";
import { RoutedBackend } from "./server/backends";
import { AuditLog } from "./server/audit";
import { BindingStore } from "./server/bindings";
import { TicketsHttp } from "./server/http";
import { migrateLegacyData } from "./server/files";
import { CAPABILITY_ENV, injectTickets, LEGACY_CAPABILITY_ENV } from "./server/inject";
import { KeyStore } from "./server/keys";
import { ConfigService } from "./server/config";
import { Dispatcher, type Paseo } from "./server/dispatch";
import { GitSource } from "./server/gitsource";
import { Ledger } from "./server/ledger";
import { INSTRUCTIONS } from "./server/instructions";
import { McpServer } from "./server/mcp";
import { TicketService } from "./server/service";
import { TOOLS } from "./server/tools";
import { Transitions } from "./server/transitions";
import { dispatchRefreshRpc, dispatchSettings, dispatchStartRpc, dispatchStatusRpc, type DispatchSettings } from "./shared/dispatch";
import { boundTicket } from "./shared/plugin";
import { auditRpc, clearKeyRpc, setKeyRpc, statusRpc } from "./shared/rpc";

const DEFAULT_PORT = 47823;

export default function contribute(server: PluginServerContext) {
  migrateLegacyData();
  const keys = new KeyStore();
  const audit = new AuditLog();
  const bindings = new BindingStore();
  const backend = new RoutedBackend(keys);
  const transitions = new Transitions(backend, audit);
  const http = new TicketsHttp({ bindings, mcp: new McpServer(TOOLS, undefined, INSTRUCTIONS), transitions });

  // The Paseo API only reaches a plugin through hook and RPC contexts: keep the first one seen.
  let paseo: Paseo | null = null;
  const capture = (ctx: { paseo: Paseo } | undefined) => {
    if (ctx?.paseo && !paseo) paseo = ctx.paseo;
  };

  const dispatchConf = server.registerSettings(dispatchSettings);
  async function currentDispatchSettings(): Promise<DispatchSettings> {
    const state = await dispatchConf.read();
    // Unreadable settings must not switch automatic dispatch on.
    return state.status === "ready" ? state.values : dispatchSettings.schema.parse({});
  }
  const gitSource = new GitSource();
  const configService = new ConfigService();
  async function refreshConfig() {
    const { source } = await currentDispatchSettings();
    if (!source) return;
    await gitSource.sync(source);
    if (gitSource.error) configService.fail(`Config source: ${gitSource.error}`);
    else configService.load(gitSource.folder(source));
  }
  const dispatcher = new Dispatcher({
    backend,
    ledger: new Ledger(),
    bindings,
    config: () => configService.state,
    settings: currentDispatchSettings,
    paseo: () => paseo,
  });
  let configTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  const scheduleConfig = async () => {
    await refreshConfig().catch(() => undefined);
    if (closed) return;
    const minutes = (await currentDispatchSettings().catch(() => null))?.source?.intervalMinutes ?? 5;
    configTimer = setTimeout(() => void scheduleConfig(), minutes * 60_000);
  };
  void scheduleConfig();
  dispatcher.startPolling();

  let url: string | null = null;
  let startError: string | null = null;
  const service = new TicketService(keys, bindings, backend, () => ({ url, error: startError }));

  // Resumed agents keep the URL they were created with, so the port has to be stable.
  const port = Number(process.env.TICKETS_DISPATCHER_PORT ?? process.env.AGENTS_TICKETS_SYNC_PORT ?? DEFAULT_PORT);
  const started = http.start(port).then(
    (u) => {
      url = u;
    },
    (err: Error) => {
      startError = `tickets-dispatcher cannot listen on 127.0.0.1:${port}: ${err.message}. Set TICKETS_DISPATCHER_PORT on the daemon.`;
      console.error(startError);
    },
  );

  const removeCreate = server.before("agent.create", async ({ request }, ctx) => {
    capture(ctx);
    // Throws on a malformed value: better a refused agent than one silently unbound.
    const issue = boundTicket(request.env, (value) => backend.parseKey(value));
    if (!issue) return;
    await started;
    if (!url) throw new Error(`${startError} Create the agent without PASEO_AGENT_TICKET to skip tickets.`);
    return injectTickets(request, { url, capability: bindings.create(issue, request.config.cwd), issue });
  });

  // The session opens after the agent exists, so this is where the capability learns its agent and
  // where "agent start" happens. Resumes retry a start that did not land; the move is forward-only.
  const removeOpen = server.before("agent.session_open", ({ request }, ctx) => {
    capture(ctx);
    const capability = request.env[CAPABILITY_ENV] ?? request.env[LEGACY_CAPABILITY_ENV];
    if (!capability || request.purpose !== "interactive") return;
    const binding = bindings.bind(capability, request.agentId);
    if (!binding || binding.started) return;
    void transitions.start(binding.issue, request.agentId).then((outcome) => {
      if (outcome.ok) bindings.markStarted(request.agentId);
    });
  });
  const removeArchived = server.on("agent.archived", ({ agent }, ctx) => {
    capture(ctx);
    bindings.archive(agent.id);
  });

  server.handle(statusRpc, (_input, ctx) => {
    capture(ctx);
    return service.status();
  });
  server.handle(dispatchStatusRpc, async (_input, ctx) => {
    capture(ctx);
    return dispatcher.status(await currentDispatchSettings(), { configured: configService.loaded, syncedAt: configService.syncedAt });
  });
  server.handle(dispatchStartRpc, async ({ issue }, ctx) => {
    capture(ctx);
    return dispatcher.start(issue);
  });
  server.handle(dispatchRefreshRpc, async (_input, ctx) => {
    capture(ctx);
    await refreshConfig();
    await dispatcher.pollOnce();
    return {};
  });
  server.handle(auditRpc, ({ limit }) => ({ entries: audit.recent(limit) }));
  server.handle(setKeyRpc, ({ backend: id, name, key }) => service.setKey(id, name, key));
  server.handle(clearKeyRpc, ({ name }) => {
    service.clearKey(name);
    return {};
  });

  return async () => {
    closed = true;
    dispatcher.stop();
    if (configTimer) clearTimeout(configTimer);
    removeCreate();
    removeOpen();
    removeArchived();
    await http.stop();
  };
}
