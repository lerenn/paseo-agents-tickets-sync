Binds Paseo agents to Linear tickets so the ticket's status follows the work without the agent doing the bookkeeping.

Create an agent with the environment variable `PASEO_LINEAR_ISSUE=ANY-1234` and it is bound to that ticket. When the agent starts, the ticket moves to In Progress, unless it is already further along (In Review, Ready To Release, Done) or canceled. Tickets never move backwards, and a canceled ticket is never touched.

The agent gets three tools. `linear_comment` posts a short milestone comment, once per distinct text. `linear_blocked` posts a reason and moves the ticket to Blocked when its team has that state. `linear_done` posts verification evidence and moves the ticket to Done; it refuses a call without evidence. Chat is never streamed to Linear, and every comment starts with `[Paseo]`. An agent can only act on its own ticket: the tools take no ticket argument.

## Setup

Add a Linear API key per Linear workspace on the Linear screen. A key is checked when saved, stored on the daemon in a file only its user can read, and never shown again. Agents never see it; the daemon makes every Linear call. When several workspaces are configured, each key is tried until one can see the ticket.

The screen also lists bound agents with their ticket's live state, and recent transitions with what was applied, skipped or failed.

## Limits

The plugin serves its tools on `127.0.0.1:47823`; set `LINEAR_PLUGIN_PORT` on the daemon to change it. A ticket whose team lacks an In Progress or Done state is left unchanged and the attempt is recorded. If Linear is unreachable when an agent starts, the move is retried the next time the agent's session opens. Dispatching agents from tickets is not part of this version.
