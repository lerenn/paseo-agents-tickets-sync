/**
 * Sent in the MCP `initialize` result, so a client that supports server instructions puts it in the
 * agent's context. Keep it short: it is read on every session.
 */
export const INSTRUCTIONS = `This agent is bound to one ticket (PASEO_AGENT_TICKET). Its status is managed for you: it moves to In Progress when you start. The tools below act only on that ticket.

- ticket_status: read the ticket's title, URL and current state.
- ticket_comment: record a milestone (plan agreed, PR opened, finding). Not a chat log; the same text is posted once.
- ticket_blocked: you cannot proceed. Give the reason and what would unblock the work.
- ticket_done: the work is finished and verified. Requires evidence: what you ran or checked, and the result.

Rules:
- Never edit the ticket any other way (status, labels, assignee, description), through another tool or a browser.
- Call ticket_done only after verifying the work. Without evidence it is refused and nothing changes.
- If a tool reports an error, say so in your answer. Do not retry in a loop.`;
