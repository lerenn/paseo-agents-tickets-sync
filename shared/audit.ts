import { z } from "zod";

export const auditEntrySchema = z.object({
  at: z.number(),
  issue: z.string(),
  agentId: z.string().nullable(),
  kind: z.enum(["start", "comment", "done", "blocked"]),
  outcome: z.enum(["applied", "skipped", "failed"]),
  /** State name before and after, when the status was involved. */
  from: z.string().nullable(),
  to: z.string().nullable(),
  detail: z.string(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;
