import type { Logger } from "@checkmate-monitor/backend-api";
import type {
  JiraProject,
  JiraIssueType,
  JiraField,
  JiraConnection,
} from "@checkmate-monitor/integration-jira-common";

/**
 * Connection config for generic connection management.
 * Mirrors the structure from provider.ts.
 */
export interface JiraConnectionConfig {
  baseUrl: string;
  email: string;
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
 * Options for creating a Jira client.
 */
interface JiraClientOptions {
  baseUrl: string;
  email: string;
  apiToken: string;
  logger: Logger;
}

/**
 * Create a typed Jira REST API client.
 */
export function createJiraClient(options: JiraClientOptions) {
  const { baseUrl, email, apiToken, logger } = options;

  // Build basic auth header
  const authHeader = `Basic ${Buffer.from(`${email}:${apiToken}`).toString(
    "base64"
  )}`;

  /**
   * Make an authenticated request to the Jira API.
   */
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${baseUrl.replace(/\/$/, "")}/rest/api/3${path}`;

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
        { url, error: errorText }
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
        await request<{ accountId: string }>("/myself");
        return { success: true };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : "Unknown error",
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
        `/project/${encodeURIComponent(projectKey)}?expand=issueTypes`
      );

      logger.debug(
        `Found ${
          result.issueTypes?.length ?? 0
        } issue types for project ${projectKey}`
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
     */
    async getFields(
      projectKey: string,
      issueTypeId: string
    ): Promise<JiraField[]> {
      interface CreateMeta {
        projects: Array<{
          issuetypes: Array<{
            id: string;
            fields: Record<
              string,
              {
                key: string;
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
              }
            >;
          }>;
        }>;
      }

      const result = await request<CreateMeta>(
        `/issue/createmeta?projectKeys=${encodeURIComponent(
          projectKey
        )}&issuetypeIds=${issueTypeId}&expand=projects.issuetypes.fields`
      );

      const project = result.projects?.[0];
      const issueType = project?.issuetypes?.find((t) => t.id === issueTypeId);

      if (!issueType) {
        return [];
      }

      return Object.entries(issueType.fields).map(([key, field]) => ({
        key,
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
        // Use Atlassian Document Format for description
        fields.description = {
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
  };
}

/**
 * Create a Jira client from a generic connection config.
 * Used with the generic connection management system.
 */
export function createJiraClientFromConfig(
  config: JiraConnectionConfig,
  logger: Logger
) {
  return createJiraClient({
    baseUrl: config.baseUrl,
    email: config.email,
    apiToken: config.apiToken,
    logger,
  });
}

/**
 * Create a Jira client from a connection configuration.
 * @deprecated Use createJiraClientFromConfig with generic connection management.
 */
export function createJiraClientFromConnection(
  connection: JiraConnection,
  logger: Logger
) {
  return createJiraClient({
    baseUrl: connection.baseUrl,
    email: connection.email,
    apiToken: connection.apiToken,
    logger,
  });
}

export type JiraClient = ReturnType<typeof createJiraClient>;
