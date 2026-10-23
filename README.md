# paseo-tickets-dispatcher

A deterministic [Paseo](https://paseo.sh) plugin that turns tickets into agents and keeps tickets in step with their work, with Linear as the first backend. (Previously `agents-tickets-sync`; the state directory, the old env names and the old port variable are migrated or still honored.) Registry id: `lerenn/tickets-dispatcher`. See [OVERVIEW.md](OVERVIEW.md) for what it does and how to set it up.

## Design

- **Binding.** `before("agent.create")` reads `PASEO_AGENT_TICKET` (alias `PASEO_LINEAR_ISSUE`, which must agree if both are set) from the agent's environment. A malformed key refuses the agent. A valid one mints a per-agent capability token tied to that ticket, injects the `paseo-tickets-dispatcher` MCP server (pre-approved tools) and a short system prompt note. The tools take no ticket argument, so an agent can only touch its own ticket.
- **Start.** `before("agent.session_open")` learns the agent's id from the capability and moves the ticket to In Progress, once. A failed start is retried on the next session open.
- **Status machine** (`server/transitions.ts`). Ranks come from state names first, then Linear's state type, so Ready To Release (typed completed by Linear) counts as open. Moves are forward-only, canceled tickets are never touched, each ticket's operations are serialized, comments are deduplicated through the audit log, and `done` posts its comment before the move so a failed move is retried without a second comment. Every attempt is audited in `~/.paseo/plugin-data/tickets-dispatcher/audit.jsonl`.
- **MCP.** A minimal streamable-HTTP MCP server on loopback (`server/mcp.ts`, `server/http.ts`), authenticated by the capability.
- **Auth.** Connections live in `~/.paseo/plugin-data/tickets-dispatcher/keys.json`, mode 0600, written through an RPC and never returned.

- **Backends and connections.** `server/backend.ts` is the only contract the status machine, tools and screen service use (`TicketBackend`). A connection is a named API key tied to a backend, chosen when it is added on the screen. `server/backends.ts` registers implementations (`BACKENDS`, with label and icon, which the screen's dropdown is built from) and `RoutedBackend` sends each call to the backend that owns the connection: a ticket key is looked up in backends that have a connection and whose key format accepts it, and the issue carries its backend afterwards. Adding a backend means a class implementing `TicketBackend`, an entry in `BACKENDS`, and a value in `BACKEND_IDS`; the status machine and the screen do not change. Linear-specific: `server/linear.ts` and the Linear key format in `shared/plugin.ts`.

State lives in `~/.paseo/plugin-data/tickets-dispatcher/`: `keys.json`, `bindings.json`, `audit.jsonl`.

## Dispatch

- `server/dispatch.ts` (`Dispatcher`) polls the backend (`TicketBackend.list`) per configured team and starts agents through the Paseo SDK: `workspaces.create` (worktree, branch-off, in the team's project) then `workspace.agents.create` with `PASEO_AGENT_TICKET` (and `PASEO_AGENT_ROLE` from a label), so the usual create hook binds the agent and injects the MCP tools.
- `server/ledger.ts` is written before anything is created and never cleared by polling: automatic dispatch skips any ticket with an entry. Manual start is refused only while that ticket's agent is still running.
- Concurrency counts ledger agents whose status is initializing or running (idle ones do not hold a slot). `maxConcurrent` 0 means no limit.
- Config: `shared/dispatch.ts` (settings, `dispatch.json` schema), `server/gitsource.ts` (shallow clone, refreshed on an interval, last good config kept), `server/config.ts`.

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
```

CI runs the same steps through Dagger (`dagger call all`) in a `node:22` container; see `.github/workflows/ci.yml`.

## Lessons carried over from the city's linear-sync

Forward-only moves; Ready To Release is not closed; idempotent comments with one marker prefix; team states discovered from Linear and cached for an hour, with a type fallback for custom names; every path that starts work goes through the same hook.
