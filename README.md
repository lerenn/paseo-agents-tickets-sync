# paseo-agents-tickets-sync

A deterministic [Paseo](https://paseo.sh) plugin that binds agents to tickets, with Linear as the first backend. Registry id: `lerenn/agents-tickets-sync`. See [OVERVIEW.md](OVERVIEW.md) for what it does and how to set it up.

## Design

- **Binding.** `before("agent.create")` reads `PASEO_AGENT_TICKET` (alias `PASEO_LINEAR_ISSUE`, which must agree if both are set) from the agent's environment. A malformed key refuses the agent. A valid one mints a per-agent capability token tied to that ticket, injects the `paseo-agents-tickets-sync` MCP server (pre-approved tools) and a short system prompt note. The tools take no ticket argument, so an agent can only touch its own ticket.
- **Start.** `before("agent.session_open")` learns the agent's id from the capability and moves the ticket to In Progress, once. A failed start is retried on the next session open.
- **Status machine** (`server/transitions.ts`). Ranks come from state names first, then Linear's state type, so Ready To Release (typed completed by Linear) counts as open. Moves are forward-only, canceled tickets are never touched, each ticket's operations are serialized, comments are deduplicated through the audit log, and `done` posts its comment before the move so a failed move is retried without a second comment. Every attempt is audited in `~/.paseo/plugin-data/agents-tickets-sync/audit.jsonl`.
- **MCP.** A minimal streamable-HTTP MCP server on loopback (`server/mcp.ts`, `server/http.ts`), authenticated by the capability.
- **Auth.** Keys live in `~/.paseo/plugin-data/agents-tickets-sync/keys.json`, mode 0600, written through an RPC and never returned.

- **Backends.** `server/backend.ts` is the only contract the status machine, tools and screen service use (`TicketBackend`). `server/backends.ts` registers implementations (`BACKENDS`) and `SelectedBackend` follows the `backend` setting (`shared/settings.ts`, default and only value `linear`). Adding a backend means a class implementing `TicketBackend`, an entry in `BACKENDS` with its key parser, and a value in `BACKEND_IDS`; the status machine does not change. Linear-specific: `server/linear.ts` and the Linear key format in `shared/plugin.ts`.

State lives in `~/.paseo/plugin-data/agents-tickets-sync/`: `keys.json`, `bindings.json`, `audit.jsonl`.

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
