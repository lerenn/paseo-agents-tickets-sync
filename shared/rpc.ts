import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { auditEntrySchema } from "./audit";

export const boundAgentSchema = z.object({
  agentId: z.string().nullable(),
  issue: z.string(),
  cwd: z.string(),
  started: z.boolean(),
  archived: z.boolean(),
  /** Live state of the ticket, or null when Linear could not be asked. */
  state: z.string().nullable(),
  title: z.string().nullable(),
  url: z.string().nullable(),
  createdAt: z.number(),
});
export type BoundAgent = z.infer<typeof boundAgentSchema>;

export const workspaceSchema = z.object({ name: z.string(), org: z.string().nullable() });

export const statusRpc = defineRpc({
  name: "linear.status",
  input: z.object({}),
  output: z.object({
    workspaces: z.array(workspaceSchema),
    endpoint: z.object({ url: z.string().nullable(), error: z.string().nullable() }),
    agents: z.array(boundAgentSchema),
  }),
});

/** Store a Linear API key for a workspace. Validated against Linear, then never returned. */
export const setKeyRpc = defineRpc({
  name: "linear.set-key",
  input: z.object({ name: z.string(), key: z.string() }),
  output: z.object({ org: z.string(), user: z.string() }),
});

export const clearKeyRpc = defineRpc({
  name: "linear.clear-key",
  input: z.object({ name: z.string() }),
  output: z.object({}),
});

/** Recent transitions, newest first. */
export const auditRpc = defineRpc({
  name: "linear.audit",
  input: z.object({ limit: z.number().int().min(1).max(500).default(100) }),
  output: z.object({ entries: z.array(auditEntrySchema) }),
});
