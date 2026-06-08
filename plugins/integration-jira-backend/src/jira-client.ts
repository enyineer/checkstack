import type { Logger } from "@checkstack/backend-api";
import type {
  JiraProject,
  JiraIssueType,
  JiraField,
} from "@checkstack/integration-jira-common";
import type { JiraAuthMode } from "./provider";
import { extractErrorMessage } from "@checkstack/common";

/**
 * Per-request timeout for every call to the Jira REST API. Without it an
 * unreachable or hung Jira instance leaves the underlying `fetch` pending
 * indefinitely, which can wedge a whole automation step or AI chat turn (the
 * propose-time option resolver awaits this client). Matches the 10s budget the
 * Teams/Webex actions already use.
 */
const JIRA_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Connection config for generic connection management.
 * Mirrors the structure from provider.ts.
 */
export interface JiraConnectionConfig {
  authMode?: JiraAuthMode;
  baseUrl: string;
  email?: string;
  apiToken: string;
}

/**
 * Response from creating a Jira issue.
 */
export interface CreateIssueResult {
  /** Issue ID */
  id: string;
  /** Issue key (e.g., "PROJ-123") */
  key: string;
  /** Self URL */
  self: string;
}

/**
 * Priority from Jira API.
 */
export interface JiraPriority {
  id: string;
  name: string;
  iconUrl?: string;
}

/**
 * Issue creation payload.
 */
export interface CreateIssuePayload {
  projectKey: string;
  issueTypeId: string;
  summary: string;
  description?: string;
  priorityId?: string;
  additionalFields?: Record<string, unknown>;
}

/**
 * A workflow transition the current user can apply to a Jira issue.
 *
 * Returned by `getTransitions`; the `id` is what you pass back to
 * `transitionIssue`. `to` describes the destination status so callers
 * can detect "already there" idempotency.
 */
export interface JiraTransition {
  id: string;
  name: string;
  to?: {
    id: string;
    name: string;
  };
}

/**
 * Current status of an issue, as returned by `getIssueStatus`.
 */
export interface JiraIssueStatus {
  id: string;
  name: string;
  /** Top-level category (e.g. "done", "indeterminate", "new"). */
  statusCategoryKey?: string;
}

/**
 * Lightweight projection of an issue returned by `searchIssues`. Mirrors
 * the fields the `integration-jira.issue_search` artifact surfaces so an
 * automation can gate on an existing ticket without a hand-rolled fetch.
 */
export interface JiraSearchHit {
  key: string;
  url: string;
  status?: string;
  summary?: string;
}

/**
 * Result of a read-only issue search.
 */
export interface JiraSearchResult {
  found: boolean;
  count: number;
  issues: JiraSearchHit[];
  firstIssueKey?: string;
}

/**
 * Input for `searchIssues`. Either pass a raw `jql` string, or a
 * structured query that is compiled into JQL, or both (they are ANDed).
 */
export interface SearchIssuesPayload {
  jql?: string;
  projectKey?: string;
  status?: string;
  statusCategory?: string;
  summaryContains?: string;
  /** Cap on returned issues; defaults to 25, hard-capped at 100. */
  maxResults?: number;
}

/**
 * Escape a value for safe inclusion inside a quoted JQL string literal.
 * JQL uses backslash escaping inside double quotes.
 */
function quoteJqlValue(value: string): string {
  return `"${value.replaceAll("\\", String.raw`\\`).replaceAll('"', String.raw`\"`)}"`;
}

/**
 * Compile a structured query (plus optional raw JQL) into a single JQL
 * string. Clauses are ANDed; an empty query yields an empty string.
 */
export function buildSearchJql(payload: SearchIssuesPayload): string {
  const { jql, projectKey, status, statusCategory, summaryContains } = payload;
  const clauses: string[] = [];
  if (projectKey && projectKey.trim().length > 0) {
    clauses.push(`project = ${quoteJqlValue(projectKey.trim())}`);
  }
  if (status && status.trim().length > 0) {
    clauses.push(`status = ${quoteJqlValue(status.trim())}`);
  }
  if (statusCategory && statusCategory.trim().length > 0) {
    clauses.push(`statusCategory = ${quoteJqlValue(statusCategory.trim())}`);
  }
  if (summaryContains && summaryContains.trim().length > 0) {
    clauses.push(`summary ~ ${quoteJqlValue(summaryContains.trim())}`);
  }
  if (jql && jql.trim().length > 0) {
    clauses.push(`(${jql.trim()})`);
  }
  return clauses.join(" AND ");
}

/**
 * Options for creating a Jira client.
 */
interface JiraClientOptions {
  authMode?: JiraAuthMode;
  baseUrl: string;
  email?: string;
  apiToken: string;
  logger: Logger;
}

/**
 * API version per api-name.
 * Data Center versions each api-name independently.
 * Currently we only use the 'api' name. Cloud=3, Data Center=2.
 */
const API_VERSIONS = {
  cloud: { api: "3", agile: "1", auth: "1" },
  datacenter: { api: "2", agile: "1", auth: "1" },
} as const;

/**
 * Create a typed Jira REST API client.
 */
export function createJiraClient(options: JiraClientOptions) {
  const { baseUrl, email, apiToken, logger, authMode = "cloud" } = options;

  // Build auth header based on mode
  const authHeader =
    authMode === "datacenter"
      ? `Bearer ${apiToken}`
      : `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;

  // Resolve API version for the 'api' name
  const apiVersion = API_VERSIONS[authMode].api;

  /**
   * Make an authenticated request to the Jira API.
   */
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${baseUrl.replace(/\/$/, "")}/rest/api/${apiVersion}${path}`;

    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...init?.headers,
      },
      signal: init?.signal ?? AbortSignal.timeout(JIRA_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        `Jira API error: ${response.status} ${response.statusText}`,
        { url, error: errorText },
      );
      throw new Error(`Jira API error: ${response.status} - ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  return {
    /**
     * Test connection by fetching the current user.
     */
    async testConnection(): Promise<{ success: boolean; message?: string }> {
      try {
        // Cloud returns accountId, Data Center returns name/key — we only check for success
        await request<Record<string, unknown>>("/myself");
        return { success: true };
      } catch (error) {
        return {
          success: false,
          message: extractErrorMessage(error, "Unknown error"),
        };
      }
    },

    /**
     * Get all accessible projects.
     */
    async getProjects(): Promise<JiraProject[]> {
      interface ProjectResponse {
        id: string;
        key: string;
        name: string;
        avatarUrls?: Record<string, string>;
      }

      const result = await request<ProjectResponse[]>("/project");
      return result.map((p) => ({
        id: p.id,
        key: p.key,
        name: p.name,
        avatarUrls: p.avatarUrls,
      }));
    },

    /**
     * Get issue types for a project.
     * Uses the /project/{projectIdOrKey}?expand=issueTypes endpoint.
     */
    async getIssueTypes(projectKey: string): Promise<JiraIssueType[]> {
      interface ProjectWithIssueTypes {
        id: string;
        key: string;
        name: string;
        issueTypes: Array<{
          id: string;
          name: string;
          description?: string;
          iconUrl?: string;
          subtask: boolean;
        }>;
      }

      logger.debug(`Fetching issue types for project: ${projectKey}`);

      const result = await request<ProjectWithIssueTypes>(
        `/project/${encodeURIComponent(projectKey)}?expand=issueTypes`,
      );

      logger.debug(
        `Found ${
          result.issueTypes?.length ?? 0
        } issue types for project ${projectKey}`,
      );

      // Filter out subtasks for simpler UX
      return (result.issueTypes || [])
        .filter((t) => !t.subtask)
        .map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          iconUrl: t.iconUrl,
          subtask: t.subtask,
        }));
    },

    /**
     * Get fields available for creating issues with a specific type.
     * Uses the /issue/createmeta/{projectIdOrKey}/issuetypes/{issueTypeId} endpoint.
     */
    async getFields(
      projectKey: string,
      issueTypeId: string,
    ): Promise<JiraField[]> {
      interface FieldsResponse {
        startAt: number;
        maxResults: number;
        total: number;
        fields: Array<{
          key: string;
          fieldId: string;
          name: string;
          required: boolean;
          schema?: {
            type: string;
            system?: string;
            custom?: string;
            customId?: number;
          };
          allowedValues?: Array<{
            id: string;
            name?: string;
            value?: string;
          }>;
        }>;
      }

      logger.debug(
        `Fetching fields for project: ${projectKey}, issueType: ${issueTypeId}`,
      );

      const result = await request<FieldsResponse>(
        `/issue/createmeta/${encodeURIComponent(
          projectKey,
        )}/issuetypes/${encodeURIComponent(issueTypeId)}`,
      );

      logger.debug(
        `Found ${
          result.fields?.length ?? 0
        } fields for project ${projectKey}, issueType ${issueTypeId}`,
      );

      return (result.fields || []).map((field) => ({
        key: field.key || field.fieldId,
        name: field.name,
        required: field.required,
        schema: field.schema,
        allowedValues: field.allowedValues,
      }));
    },

    /**
     * Get available priorities.
     */
    async getPriorities(): Promise<JiraPriority[]> {
      interface PriorityResponse {
        id: string;
        name: string;
        iconUrl?: string;
      }

      const result = await request<PriorityResponse[]>("/priority");
      return result.map((p) => ({
        id: p.id,
        name: p.name,
        iconUrl: p.iconUrl,
      }));
    },

    /**
     * Create a new issue.
     */
    async createIssue(payload: CreateIssuePayload): Promise<CreateIssueResult> {
      const {
        projectKey,
        issueTypeId,
        summary,
        description,
        priorityId,
        additionalFields,
      } = payload;

      // Build the issue fields
      const fields: Record<string, unknown> = {
        project: { key: projectKey },
        issuetype: { id: issueTypeId },
        summary,
        ...additionalFields,
      };

      if (description) {
        // Data Center uses plain text (REST API v2), Cloud uses Atlassian Document Format (REST API v3)
        fields.description =
          authMode === "datacenter"
            ? description
            : {
                type: "doc",
                version: 1,
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: description }],
                  },
                ],
              };
      }

      if (priorityId) {
        fields.priority = { id: priorityId };
      }

      return request<CreateIssueResult>("/issue", {
        method: "POST",
        body: JSON.stringify({ fields }),
      });
    },

    /**
     * Get the current status of an issue. Used by `transitionIssue` to
     * short-circuit when the destination already matches.
     */
    async getIssueStatus(issueKey: string): Promise<JiraIssueStatus | undefined> {
      interface IssueResponse {
        fields?: {
          status?: {
            id: string;
            name: string;
            statusCategory?: { key: string };
          };
        };
      }
      const result = await request<IssueResponse>(
        `/issue/${encodeURIComponent(issueKey)}?fields=status`,
      );
      const status = result.fields?.status;
      if (!status) return;
      return {
        id: status.id,
        name: status.name,
        statusCategoryKey: status.statusCategory?.key,
      };
    },

    /**
     * Read-only issue search. Compiles the structured query (and/or raw
     * JQL) into JQL and queries the Jira search endpoint, returning a
     * lightweight projection an automation can gate on (e.g. "is there an
     * open ticket already?").
     */
    async searchIssues(
      payload: SearchIssuesPayload,
    ): Promise<JiraSearchResult> {
      const jql = buildSearchJql(payload);
      const maxResults = Math.min(Math.max(payload.maxResults ?? 25, 1), 100);

      interface SearchResponse {
        total?: number;
        issues?: Array<{
          key: string;
          fields?: {
            summary?: string;
            status?: { name?: string };
          };
        }>;
      }

      // Jira Cloud DEPRECATED the legacy `/search` endpoint on 2024-05-01 and
      // REMOVED it on 2025-05-01 (Atlassian CHANGE-2046); it now returns HTTP 410
      // and requires `/search/jql`. The new endpoint is paginated via
      // `nextPageToken` and returns NO `total`. Jira Data Center / Server (on-prem,
      // which can be older) still serves the legacy `/search` and has no
      // `/search/jql`, so choose the endpoint by auth mode.
      const searchPath = authMode === "datacenter" ? "/search" : "/search/jql";
      const result = await request<SearchResponse>(searchPath, {
        method: "POST",
        body: JSON.stringify({
          jql,
          maxResults,
          fields: ["summary", "status"],
        }),
      });

      const browseBase = baseUrl.replace(/\/$/, "");
      const issues: JiraSearchHit[] = (result.issues ?? []).map((issue) => ({
        key: issue.key,
        url: `${browseBase}/browse/${issue.key}`,
        status: issue.fields?.status?.name,
        summary: issue.fields?.summary,
      }));
      // `/search/jql` (Cloud) returns no `total`, so existence is derived from the
      // returned issues; Data Center's `/search` still provides `total`.
      const count = result.total ?? issues.length;
      return {
        found: count > 0,
        count,
        issues,
        firstIssueKey: issues[0]?.key,
      };
    },

    /**
     * Get the workflow transitions currently available on an issue.
     */
    async getTransitions(issueKey: string): Promise<JiraTransition[]> {
      interface TransitionsResponse {
        transitions: Array<{
          id: string;
          name: string;
          to?: { id: string; name: string };
        }>;
      }
      const result = await request<TransitionsResponse>(
        `/issue/${encodeURIComponent(issueKey)}/transitions`,
      );
      return (result.transitions ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        to: t.to ? { id: t.to.id, name: t.to.name } : undefined,
      }));
    },

    /**
     * Apply a workflow transition to an issue. The optional `comment`
     * is posted as the transition's accompanying audit note.
     *
     * Returns `alreadyApplied: true` if the issue's current status
     * already matches the requested transition's destination — callers
     * should treat that as success.
     */
    async transitionIssue(
      issueKey: string,
      transitionId: string,
      comment?: string,
    ): Promise<{ alreadyApplied: boolean }> {
      // Check destination first so we can short-circuit idempotently.
      const [available, current] = await Promise.all([
        this.getTransitions(issueKey),
        this.getIssueStatus(issueKey),
      ]);
      const target = available.find((t) => t.id === transitionId);
      if (!target) {
        throw new Error(
          `Transition ${transitionId} is not available on ${issueKey}`,
        );
      }
      if (target.to && current && target.to.id === current.id) {
        return { alreadyApplied: true };
      }

      const body: Record<string, unknown> = {
        transition: { id: transitionId },
      };
      if (comment) {
        const commentBody =
          authMode === "datacenter"
            ? comment
            : {
                type: "doc",
                version: 1,
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: comment }],
                  },
                ],
              };
        body.update = {
          comment: [{ add: { body: commentBody } }],
        };
      }
      // Jira returns 204 No Content for transitions — bypass `request`
      // which always tries to JSON-parse the body.
      const url = `${baseUrl.replace(/\/$/, "")}/rest/api/${apiVersion}/issue/${encodeURIComponent(issueKey)}/transitions`;
      const response = await fetch(url, {
        method: "POST",
        body: JSON.stringify(body),
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(JIRA_REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          `Jira API error: ${response.status} ${response.statusText}`,
          { url, error: errorText },
        );
        throw new Error(`Jira API error: ${response.status} - ${errorText}`);
      }
      return { alreadyApplied: false };
    },

    /**
     * Post a comment on an issue without a workflow transition.
     */
    async addComment(issueKey: string, body: string): Promise<{ id: string }> {
      const commentBody =
        authMode === "datacenter"
          ? body
          : {
              type: "doc",
              version: 1,
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: body }],
                },
              ],
            };
      interface CommentResponse {
        id: string;
      }
      const result = await request<CommentResponse>(
        `/issue/${encodeURIComponent(issueKey)}/comment`,
        {
          method: "POST",
          body: JSON.stringify({ body: commentBody }),
        },
      );
      return { id: result.id };
    },
  };
}

/**
 * Create a Jira client from a generic connection config.
 * Used with the generic connection management system.
 */
export function createJiraClientFromConfig(
  config: JiraConnectionConfig,
  logger: Logger,
) {
  return createJiraClient({
    authMode: config.authMode ?? "cloud",
    baseUrl: config.baseUrl,
    email: config.email,
    apiToken: config.apiToken,
    logger,
  });
}

export type JiraClient = ReturnType<typeof createJiraClient>;
