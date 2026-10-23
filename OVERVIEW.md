Binds Paseo agents to tickets (formerly Agents Tickets Sync) so the ticket's status follows the work without the agent doing the bookkeeping. Linear is the first (and so far only) ticket system.

Create an agent with the environment variable `PASEO_AGENT_TICKET=ANY-1234` and it is bound to that ticket. `PASEO_LINEAR_ISSUE` is accepted as an alias; if both are set they must name the same ticket. When the agent starts, the ticket moves to In Progress, unless it is already further along (In Review, Ready To Release, Done) or canceled. Tickets never move backwards, and a canceled ticket is never touched.

The agent gets four tools. `ticket_comment` posts a short milestone comment, once per distinct text. `ticket_blocked` posts a reason and moves the ticket to Blocked when its team has that state. `ticket_done` posts verification evidence and moves the ticket to Done; it refuses a call without evidence. `ticket_status` reads the ticket. Chat is never streamed to the ticket, and every comment starts with `[Paseo]`. An agent can only act on its own ticket: the tools take no ticket argument.

## Dispatch

The plugin can also start the agents. Manually: type a ticket key in the Dispatch section and press Start Agent. Automatically: with automatic dispatch on, it asks the ticket system every minute or slower for tickets that carry a label (default `paseo`, per team if configured) and are in an eligible state (by default not yet started), and starts an agent for each in the Paseo project its team maps to, in a new worktree workspace. The agent is created bound to the ticket. A ticket is dispatched automatically at most once, even if its agent is later archived; a failed start is shown with its error and is not retried by itself, but can be started by hand. A limit on dispatched agents running at once (default 3, 0 for no limit) holds the others until a slot frees up. Automatic dispatch is off until you switch it on in the Dispatch settings.

The team to project mapping is configuration, not code. It lives in a `dispatch.json` in a folder of a git repository that you point the plugin at (URL, ref, folder), read-only and refreshed every few minutes, with no secrets in it:

```json
{
  "provider": "claude",
  "teams": {
    "ANY": { "project": "Monorepo", "label": "paseo", "roles": { "reviewer": "reviewer" } },
    "DVRL": { "project": "prj_98ac61984d878854", "provider": "codex", "states": ["unstarted", "backlog"] }
  }
}
```

`project` is a Paseo project id or name. `label` is the dispatch label (defaults to the setting). `states` lists the eligible state types (default `unstarted`). `roles` maps a ticket label to an agents-roles role, set as `PASEO_AGENT_ROLE` on the agent. `provider` is `provider` or `provider/model`. `connection` limits a team to one connection.

## Setup

Open the Tickets Dispatcher screen and add a connection: pick the ticket system, name the workspace and paste its API key. A key is checked when saved, stored on the daemon in a file only its user can read, and never shown again. Agents never see it; the daemon makes every call to the ticket system. When several connections exist, each one that accepts the ticket key format is tried until one can see the ticket.

Linear is the only ticket system today. The screen also lists bound agents with their ticket's live state, and recent transitions with what was applied, skipped or failed.

## Limits

The plugin serves its tools on `127.0.0.1:47823`; set `TICKETS_DISPATCHER_PORT` on the daemon to change it. State is kept in `~/.paseo/plugin-data/tickets-dispatcher`. A ticket whose team lacks an In Progress or Done state is left unchanged and the attempt is recorded. If the ticket system is unreachable when an agent starts, the move is retried the next time the agent's session opens. The Paseo API only reaches a plugin through hooks and screen calls, so after a daemon restart automatic dispatch starts working once the screen is opened or any agent starts.
