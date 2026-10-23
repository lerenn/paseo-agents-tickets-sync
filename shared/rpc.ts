import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { auditEntrySchema } from "./audit";

export const boundAgentSchema = z.object({
  agentId: z.string().nullable(),
  issue: z.string(),
  cwd: z.string(),
  started: z.boolean(),
  archived: z.boolean(),
  /** Live state of the ticket, or null when the ticket system could not be asked. */
  state: z.string().nullable(),
  title: z.string().nullable(),
  url: z.string().nullable(),
  createdAt: z.number(),
});
export type BoundAgent = z.infer<typeof boundAgentSchema>;

export const workspaceSchema = z.object({ name: z.string(), scope: z.string().nullable() });

export const statusRpc = defineRpc({
  name: "agent-tickets.status",
  input: z.object({}),
  output: z.object({
    /** Label of the selected backend, for example Linear. */
    backend: z.string(),
    workspaces: z.array(workspaceSchema),
    endpoint: z.object({ url: z.string().nullable(), error: z.string().nullable() }),
    agents: z.array(boundAgentSchema),
  }),
});

/** Store an API key for a workspace of the selected backend. Validated against it, then never returned. */
export const setKeyRpc = defineRpc({
  name: "agent-tickets.set-key",
  input: z.object({ name: z.string(), key: z.string() }),
  output: z.object({ scope: z.string(), user: z.string() }),
});

export const clearKeyRpc = defineRpc({
  name: "agent-tickets.clear-key",
  input: z.object({ name: z.string() }),
  output: z.object({}),
});

/** Recent transitions, newest first. */
export const auditRpc = defineRpc({
  name: "agent-tickets.audit",
  input: z.object({ limit: z.number().int().min(1).max(500).default(100) }),
  output: z.object({ entries: z.array(auditEntrySchema) }),
});
