import { NoKeyError, type Issue, type ListQuery, type TeamState, type TicketBackend } from "./backend";
import type { KeyStore } from "./keys";

export class LinearError extends Error {}

const URL_DEFAULT = "https://api.linear.app/graphql";
const STATES_TTL_MS = 3600_000;

type Fetch = typeof fetch;

const ISSUE_FIELDS = "id identifier title url description state { id name type } team { id key } labels { nodes { name } }";

type RawIssue = Omit<Issue, "workspace" | "backend" | "labels"> & { labels?: { nodes: { name: string }[] } };

function toIssue(raw: RawIssue, workspace: string): Issue {
  const { labels, ...rest } = raw;
  return { ...rest, labels: labels?.nodes.map((l) => l.name) ?? [], workspace, backend: "linear" };
}

/**
 * Linear GraphQL over the stored keys. An issue key such as ANY-1234 only says which team it is
 * in, not which Linear workspace, so each key is tried until one sees the issue; the winner is
 * remembered per team prefix.
 */
export class LinearClient implements TicketBackend {
  private readonly prefixOwner = new Map<string, string>();
  private readonly stateCache = new Map<string, { at: number; states: TeamState[] }>();

  constructor(
    private readonly keys: KeyStore,
    private readonly opts: { fetch?: Fetch; url?: string; now?: () => number } = {},
  ) {}

  private async gql<T>(workspace: string, query: string, variables: Record<string, unknown>): Promise<T> {
    const key = this.keys.get(workspace);
    if (!key) throw new NoKeyError();
    const res = await (this.opts.fetch ?? fetch)(this.opts.url ?? URL_DEFAULT, {
      method: "POST",
      // A personal API key is sent as-is, without a Bearer prefix.
      headers: { "content-type": "application/json", authorization: key },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 401 || res.status === 403) throw new LinearError(`Linear refused the API key of workspace "${workspace}" (HTTP ${res.status}).`);
    if (!res.ok) throw new LinearError(`Linear answered HTTP ${res.status}.`);
    const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length) throw new LinearError(body.errors.map((e) => e.message).join("; "));
    return body.data as T;
  }

  /** Validates a key and returns the Linear organization it belongs to. */
  async validateCredential(key: string): Promise<{ scope: string; user: string }> {
    const res = await (this.opts.fetch ?? fetch)(this.opts.url ?? URL_DEFAULT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: key },
      body: JSON.stringify({ query: "query { viewer { name organization { urlKey } } }" }),
    });
    if (res.status === 401 || res.status === 403) throw new LinearError("Linear refused this API key.");
    if (!res.ok) throw new LinearError(`Linear answered HTTP ${res.status}.`);
    const body = (await res.json()) as { data?: { viewer?: { name: string; organization: { urlKey: string } } }; errors?: { message: string }[] };
    if (body.errors?.length || !body.data?.viewer) throw new LinearError(body.errors?.map((e) => e.message).join("; ") ?? "Linear returned no viewer.");
    return { scope: body.data.viewer.organization.urlKey, user: body.data.viewer.name };
  }

  async issue(key: string): Promise<Issue | null> {
    const prefix = key.split("-")[0];
    const known = this.prefixOwner.get(prefix);
    const names = this.keys.names("linear");
    const order = known && names.includes(known) ? [known, ...names.filter((n) => n !== known)] : names;
    if (order.length === 0) throw new NoKeyError();
    let lastError: Error | null = null;
    for (const workspace of order) {
      try {
        const data = await this.gql<{ issue: RawIssue | null }>(workspace, `query($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`, { id: key });
        if (data.issue) {
          this.prefixOwner.set(prefix, workspace);
          return toIssue(data.issue, workspace);
        }
      } catch (err) {
        // Linear answers "Entity not found" for an issue another workspace owns.
        if (!/not found/i.test((err as Error).message)) lastError = err as Error;
      }
    }
    if (lastError) throw lastError;
    return null;
  }

  async list(query: ListQuery): Promise<Issue[]> {
    const names = query.connection ? [query.connection].filter((n) => this.keys.backend(n) === "linear") : this.keys.names("linear");
    if (names.length === 0) throw new NoKeyError();
    const filter = {
      team: { key: { eq: query.team } },
      labels: { name: { eqIgnoreCase: query.label } },
      state: { type: { in: query.stateTypes } },
    };
    const found: Issue[] = [];
    for (const workspace of names) {
      const data = await this.gql<{ issues: { nodes: RawIssue[] } }>(
        workspace,
        `query($filter: IssueFilter!, $first: Int!) { issues(filter: $filter, first: $first) { nodes { ${ISSUE_FIELDS} } } }`,
        { filter, first: query.limit ?? 50 },
      );
      found.push(...data.issues.nodes.map((n) => toIssue(n, workspace)));
    }
    return found;
  }

  async states(issue: Issue): Promise<TeamState[]> {
    const now = (this.opts.now ?? Date.now)();
    const hit = this.stateCache.get(issue.team.id);
    if (hit && now - hit.at < STATES_TTL_MS) return hit.states;
    const data = await this.gql<{ team: { states: { nodes: TeamState[] } } }>(
      issue.workspace,
      "query($id: String!) { team(id: $id) { states { nodes { id name type position } } } }",
      { id: issue.team.id },
    );
    const states = data.team.states.nodes;
    this.stateCache.set(issue.team.id, { at: now, states });
    return states;
  }

  async setState(issue: Issue, stateId: string): Promise<void> {
    const data = await this.gql<{ issueUpdate: { success: boolean } }>(
      issue.workspace,
      "mutation($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }",
      { id: issue.id, stateId },
    );
    if (!data.issueUpdate.success) throw new LinearError(`Linear did not apply the state change on ${issue.identifier}.`);
  }

  async comment(issue: Issue, body: string): Promise<void> {
    const data = await this.gql<{ commentCreate: { success: boolean } }>(
      issue.workspace,
      "mutation($issueId: String!, $body: String!) { commentCreate(input: { issueId: $issueId, body: $body }) { success } }",
      { issueId: issue.id, body },
    );
    if (!data.commentCreate.success) throw new LinearError(`Linear did not post the comment on ${issue.identifier}.`);
  }
}
