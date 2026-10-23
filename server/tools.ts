import { z } from "zod";
import { MIN_EVIDENCE, type Outcome, type Transitions } from "./transitions";

export interface ToolContext {
  /** The ticket this agent is bound to. Not an argument: an agent cannot reach another ticket. */
  issue: string;
  agentId: string | null;
  transitions: Transitions;
}

export interface ToolDef {
  name: string;
  description: string;
  input: z.ZodType;
  run(args: any, ctx: ToolContext): Promise<unknown>;
}

function report(o: Outcome): string {
  if (!o.ok) throw new Error(o.message);
  return o.message;
}

export const TOOLS: ToolDef[] = [
  {
    name: "ticket_status",
    description: "Read the ticket this agent is bound to: identifier, title, URL and current state.",
    input: z.object({}),
    async run(_args, ctx) {
      return (await ctx.transitions.status(ctx.issue)) ?? `Ticket ${ctx.issue} is not visible to the configured credentials.`;
    },
  },
  {
    name: "ticket_comment",
    description:
      "Post a short milestone comment on your ticket (a plan agreed, a PR opened, a finding). Use it sparingly: it is not a chat log. " +
      "The same comment is posted only once.",
    input: z.object({ text: z.string().min(1).describe("The comment, in markdown.") }),
    async run({ text }, ctx) {
      return report(await ctx.transitions.comment(ctx.issue, ctx.agentId, text));
    },
  },
  {
    name: "ticket_done",
    description:
      "Mark your ticket Done. Call it only when the work is finished and verified; if you cannot finish, use ticket_blocked instead. " +
      `Evidence is required (at least ${MIN_EVIDENCE} characters): what you ran or checked and the result, for example the tests passed or the PR that merged. ` +
      "It is posted on the ticket with the status change.",
    input: z.object({ evidence: z.string().min(MIN_EVIDENCE).describe("Verification evidence: commands run, results, links.") }),
    async run({ evidence }, ctx) {
      return report(await ctx.transitions.done(ctx.issue, ctx.agentId, evidence));
    },
  },
  {
    name: "ticket_blocked",
    description:
      "Say your ticket is blocked and why (waiting on a person, a decision or an outside system). Posts the reason and moves the ticket to Blocked when its team has that state.",
    input: z.object({ reason: z.string().min(1).describe("What blocks the work and what would unblock it.") }),
    async run({ reason }, ctx) {
      return report(await ctx.transitions.blocked(ctx.issue, ctx.agentId, reason));
    },
  },
];

export const TOOL_NAMES = TOOLS.map((t) => t.name);
