import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const MIN_POLL_SECONDS = 60;
export const CONFIG_FILE = "dispatch.json";

/** Linear state types a ticket may be in to be dispatched. */
export const DISPATCH_STATE_TYPES = ["triage", "backlog", "unstarted", "started"] as const;

/** One team's mapping, from the git source's dispatch.json. Non-secret. */
export const teamConfigSchema = z.object({
  /** The Paseo project to create workspaces in: its id (prj_...) or its name. */
  project: z.string().trim().min(1),
  /** Tickets with this label are dispatched. Falls back to the default label in the settings. */
  label: z.string().trim().min(1).optional(),
  /** Which ticket states are eligible. A ticket already started by someone is skipped by default. */
  states: z.array(z.enum(DISPATCH_STATE_TYPES)).min(1).default(["unstarted"]),
  /** `provider` or `provider/model`. Falls back to the file's top-level provider. */
  provider: z.string().trim().min(1).optional(),
  /** Ticket label to agents-roles role: the first match sets PASEO_AGENT_ROLE on the agent. */
  roles: z.record(z.string(), z.string().trim().min(1)).default({}),
  /** Only look in this connection. Default: every connection of the backend. */
  connection: z.string().trim().min(1).optional(),
});
export type TeamConfig = z.output<typeof teamConfigSchema>;

export const dispatchConfigSchema = z.object({
  provider: z.string().trim().min(1).default("claude"),
  /** Team key (ANY, DVRL) to its mapping. */
  teams: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,9}$/, "a team key such as ANY"), teamConfigSchema).default({}),
});
export type DispatchConfig = z.output<typeof dispatchConfigSchema>;

/** A git repository folder holding dispatch.json. Anything `git clone` accepts; credentials come from the daemon. */
export const configSourceSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1)
    .refine((v) => !v.startsWith("-"), "url must not start with '-'"),
  ref: z
    .string()
    .trim()
    .refine((v) => !v.startsWith("-"), "ref must not start with '-'")
    .optional(),
  path: z
    .string()
    .trim()
    .refine((v) => !v.split(/[\\/]/).includes(".."), "path must stay inside the repository")
    .refine((v) => !/^([\\/]|[A-Za-z]:)/.test(v), "path must be relative")
    .optional(),
  intervalMinutes: z.number().int().min(1).default(5),
});
export type ConfigSource = z.output<typeof configSourceSchema>;

export const dispatchSettings = defineSettings({
  id: "dispatch",
  scope: "host",
  version: 1,
  schema: z.object({
    /** Where the team to project mapping lives. Without it only manual starts work. */
    source: configSourceSchema.optional(),
    /** Start agents automatically for labelled tickets. Off until switched on. */
    auto: z.boolean().default(false),
    /** How often Linear is asked. Never faster than a minute. */
    pollSeconds: z.number().int().min(MIN_POLL_SECONDS).default(MIN_POLL_SECONDS),
    /** Dispatched agents running at once. 0 means no limit. */
    maxConcurrent: z.number().int().min(0).default(3),
    /** Label that marks a ticket for dispatch when a team does not name its own. */
    defaultLabel: z.string().trim().min(1).default("paseo"),
  }),
});
export type DispatchSettings = z.output<typeof dispatchSettings.schema>;

export const ledgerEntrySchema = z.object({
  issue: z.string(),
  title: z.string().nullable(),
  mode: z.enum(["auto", "manual"]),
  status: z.enum(["starting", "started", "failed"]),
  at: z.number(),
  agentId: z.string().nullable(),
  workspaceId: z.string().nullable(),
  /** Whether the agent is still working (initializing or running). Filled when listed. */
  active: z.boolean(),
  error: z.string().nullable(),
});
export type LedgerView = z.infer<typeof ledgerEntrySchema>;

export const candidateSchema = z.object({ issue: z.string(), title: z.string(), team: z.string(), url: z.string(), state: z.string() });

export const dispatchStatusRpc = defineRpc({
  name: "tickets-dispatcher.dispatch-status",
  input: z.object({}),
  output: z.object({
    configured: z.boolean(),
    configError: z.string().nullable(),
    configSyncedAt: z.number().nullable(),
    teams: z.array(z.object({ team: z.string(), project: z.string(), projectFound: z.boolean(), label: z.string(), states: z.array(z.string()) })),
    auto: z.boolean(),
    pollSeconds: z.number(),
    maxConcurrent: z.number(),
    running: z.number(),
    lastPollAt: z.number().nullable(),
    lastPollError: z.string().nullable(),
    waiting: z.array(candidateSchema),
    dispatched: z.array(ledgerEntrySchema),
  }),
});

/** Start an agent on a ticket now, whatever its label. Refused while an earlier agent of that ticket is still alive. */
export const dispatchStartRpc = defineRpc({
  name: "tickets-dispatcher.dispatch-start",
  input: z.object({ issue: z.string() }),
  output: z.object({ agentId: z.string(), workspaceId: z.string().nullable() }),
});

/** Re-read the config source and poll the tickets now. */
export const dispatchRefreshRpc = defineRpc({
  name: "tickets-dispatcher.dispatch-refresh",
  input: z.object({}),
  output: z.object({}),
});
