import { z } from "zod";

/** Ticket systems this plugin can talk to. Linear is the only one so far. */
export const BACKEND_IDS = ["linear"] as const;
export const backendIdSchema = z.enum(BACKEND_IDS);
export type BackendId = z.infer<typeof backendIdSchema>;

/** What the screen needs to offer a backend: its name and a Lucide icon. */
export const backendInfoSchema = z.object({ id: backendIdSchema, label: z.string(), icon: z.string() });
export type BackendInfo = z.infer<typeof backendInfoSchema>;
