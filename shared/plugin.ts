/** Per-agent binding to a Linear ticket. The only convention shared with other plugins and roles. */
export const ISSUE_ENV = "PASEO_LINEAR_ISSUE";

const ISSUE_KEY = /^[A-Z][A-Z0-9]{0,9}-\d{1,9}$/;

/** Normalizes `any-1234` to `ANY-1234`; returns null when the value is not a Linear issue key. */
export function parseIssueKey(value: string | undefined | null): string | null {
  const key = value?.trim().toUpperCase();
  return key && ISSUE_KEY.test(key) ? key : null;
}

/** The ticket an agent is bound to: undefined when it set none, throws on a malformed value. */
export function boundIssue(env: Record<string, string | undefined> | undefined): string | undefined {
  const raw = env?.[ISSUE_ENV];
  if (raw === undefined || raw.trim() === "") return undefined;
  const key = parseIssueKey(raw);
  if (!key) throw new Error(`${ISSUE_ENV}=${JSON.stringify(raw)} is not a Linear issue key (expected something like ANY-1234).`);
  return key;
}

/** Logical statuses, in the order a ticket moves through them. */
export type Status = "Todo" | "In Progress" | "In Review" | "Ready To Release" | "Done";
