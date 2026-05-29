import type { Logger } from "@checkstack/backend-api";
import type {
  JiraProject,
  JiraIssueType,
  JiraField,
} from "@checkstack/integration-jira-common";
import type { JiraAuthMode } from "./provider";
import { extractErrorMessage } from "@checkstack/common";

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
