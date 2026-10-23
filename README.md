# paseo-linear

A deterministic [Paseo](https://paseo.sh) plugin that binds agents to Linear tickets. Registry id: `lerenn/linear`. See [OVERVIEW.md](OVERVIEW.md) for what it does and how to set it up.

## Design

- **Binding.** `before("agent.create")` reads `PASEO_LINEAR_ISSUE` from the agent's environment. A malformed key refuses the agent. A valid one mints a per-agent capability token tied to that ticket, injects the `paseo-linear` MCP server (pre-approved tools) and a short system prompt note. The tools take no ticket argument, so an agent can only touch its own ticket.
- **Start.** `before("agent.session_open")` learns the agent's id from the capability and moves the ticket to In Progress, once. A failed start is retried on the next session open.
- **Status machine** (`server/transitions.ts`). Ranks come from state names first, then Linear's state type, so Ready To Release (typed completed by Linear) counts as open. Moves are forward-only, canceled tickets are never touched, each ticket's operations are serialized, comments are deduplicated through the audit log, and `done` posts its comment before the move so a failed move is retried without a second comment. Every attempt is audited in `~/.paseo/linear/audit.jsonl`.
- **MCP.** A minimal streamable-HTTP MCP server on loopback (`server/mcp.ts`, `server/http.ts`), authenticated by the capability.
- **Auth.** Keys live in `~/.paseo/linear/keys.json`, mode 0600, written through an RPC and never returned.

State lives in `~/.paseo/linear/`: `keys.json`, `bindings.json`, `audit.jsonl`.

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
