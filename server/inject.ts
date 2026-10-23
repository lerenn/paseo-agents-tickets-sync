import type { PluginBeforeRequests } from "@getpaseo/plugin/server";
import { TICKET_ENV } from "../shared/plugin";
import { TOOL_NAMES } from "./tools";

type CreateRequest = PluginBeforeRequests["agent.create"];

export const SERVER_NAME = "paseo-agent-tickets";
export const URL_ENV = "PASEO_AGENT_TICKETS_URL";
export const CAPABILITY_ENV = "PASEO_AGENT_TICKETS_CAPABILITY";

/** Give a new agent bound to `issue` the ticket MCP tools, pre-approved, and tell it how to use them. */
export function injectTickets(request: CreateRequest, o: { url: string; capability: string; issue: string }): CreateRequest {
  const note =
    `Tickets: you are bound to ticket ${o.issue}. Its status is managed for you: it moves to In Progress when you start. ` +
    "Use ticket_comment for a milestone worth recording (not for chat), ticket_blocked with a reason when you cannot proceed, " +
    "and ticket_done with verification evidence only when the work is finished and verified. Do not change the ticket's status any other way.";
  return {
    ...request,
    config: {
      ...request.config,
      systemPrompt: [request.config.systemPrompt, note].filter(Boolean).join("\n\n"),
      mcpServers: {
        ...request.config.mcpServers,
        [SERVER_NAME]: { type: "http", url: `${o.url}/mcp`, headers: { authorization: `Bearer ${o.capability}` }, alwaysLoad: true },
      },
      toolPolicy: {
        preapproved: [
          ...(request.config.toolPolicy?.preapproved ?? []),
          ...TOOL_NAMES.map((tool) => ({ kind: "mcp" as const, server: SERVER_NAME, tool })),
        ],
      },
    },
    env: { ...request.env, [TICKET_ENV]: o.issue, [URL_ENV]: o.url, [CAPABILITY_ENV]: o.capability },
  };
}
