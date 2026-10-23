import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** Ticket systems this plugin can talk to. Linear is the only one so far. */
export const BACKEND_IDS = ["linear"] as const;
export const backendIdSchema = z.enum(BACKEND_IDS);
export type BackendId = z.infer<typeof backendIdSchema>;

export const ticketSettings = defineSettings({
  id: "tickets",
  scope: "host",
  version: 1,
  schema: z.object({
    /** Which ticket system new agents are bound to and which credentials the screen manages. */
    backend: backendIdSchema.default("linear"),
  }),
});
