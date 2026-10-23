Binds Paseo agents to tickets so the ticket's status follows the work without the agent doing the bookkeeping. Linear is the first (and so far only) ticket system.

Create an agent with the environment variable `PASEO_AGENT_TICKET=ANY-1234` and it is bound to that ticket. `PASEO_LINEAR_ISSUE` is accepted as an alias; if both are set they must name the same ticket. When the agent starts, the ticket moves to In Progress, unless it is already further along (In Review, Ready To Release, Done) or canceled. Tickets never move backwards, and a canceled ticket is never touched.

The agent gets four tools. `ticket_comment` posts a short milestone comment, once per distinct text. `ticket_blocked` posts a reason and moves the ticket to Blocked when its team has that state. `ticket_done` posts verification evidence and moves the ticket to Done; it refuses a call without evidence. `ticket_status` reads the ticket. Chat is never streamed to the ticket, and every comment starts with `[Paseo]`. An agent can only act on its own ticket: the tools take no ticket argument.

## Setup

Open the Agents Tickets Sync screen and add a connection: pick the ticket system, name the workspace and paste its API key. A key is checked when saved, stored on the daemon in a file only its user can read, and never shown again. Agents never see it; the daemon makes every call to the ticket system. When several connections exist, each one that accepts the ticket key format is tried until one can see the ticket.

Linear is the only ticket system today. The screen also lists bound agents with their ticket's live state, and recent transitions with what was applied, skipped or failed.

## Limits

The plugin serves its tools on `127.0.0.1:47823`; set `AGENTS_TICKETS_SYNC_PORT` on the daemon to change it. State is kept in `~/.paseo/plugin-data/agents-tickets-sync`. A ticket whose team lacks an In Progress or Done state is left unchanged and the attempt is recorded. If the ticket system is unreachable when an agent starts, the move is retried the next time the agent's session opens. Dispatching agents from tickets is not part of this version.
