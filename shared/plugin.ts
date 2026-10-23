/** Per-agent binding to a ticket. The only convention shared with other plugins and roles. */
export const TICKET_ENV = "PASEO_AGENT_TICKET";

/** Earlier name of the same convention, still honored. */
export const TICKET_ENV_ALIAS = "PASEO_LINEAR_ISSUE";

const LINEAR_KEY = /^[A-Z][A-Z0-9]{0,9}-\d{1,9}$/;

/** Normalizes `any-1234` to `ANY-1234`; returns null when the value is not a Linear issue key. */
export function parseLinearKey(value: string | undefined | null): string | null {
  const key = value?.trim().toUpperCase();
  return key && LINEAR_KEY.test(key) ? key : null;
}

/**
 * The raw ticket reference an agent was created with, or undefined when it set none. Reads
 * PASEO_AGENT_TICKET, else the alias PASEO_LINEAR_ISSUE. Throws when both are set to different
 * tickets: guessing which one the creator meant would bind the agent to the wrong ticket.
 */
export function ticketRef(env: Record<string, string | undefined> | undefined): string | undefined {
  const primary = env?.[TICKET_ENV]?.trim() || undefined;
  const alias = env?.[TICKET_ENV_ALIAS]?.trim() || undefined;
  if (primary && alias && primary.toUpperCase() !== alias.toUpperCase()) {
    throw new Error(`${TICKET_ENV}=${primary} and ${TICKET_ENV_ALIAS}=${alias} name different tickets. Set only ${TICKET_ENV}.`);
  }
  return primary ?? alias;
}

/** The ticket an agent is bound to: undefined when it set none, throws when the backend rejects the value. */
export function boundTicket(env: Record<string, string | undefined> | undefined, parse: (value: string) => string | null): string | undefined {
  const raw = ticketRef(env);
  if (raw === undefined) return undefined;
  const key = parse(raw);
  if (!key) throw new Error(`${TICKET_ENV}=${JSON.stringify(raw)} is not a valid ticket key for the selected backend (for Linear, something like ANY-1234).`);
  return key;
}
