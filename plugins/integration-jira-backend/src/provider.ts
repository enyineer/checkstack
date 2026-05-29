import { z } from "zod";
import {
  Versioned,
  configString,
  type Migration,
} from "@checkstack/backend-api";
import type {
  IntegrationProvider,
  TestConnectionResult,
  ConnectionOption,
  GetConnectionOptionsParams,
} from "@checkstack/integration-backend";
import { createJiraClientFromConfig } from "./jira-client";

/**
 * Supported Jira authentication modes.
 * - cloud: Jira Cloud (email + API token, Basic Auth, REST API v3)
 * - datacenter: Jira Data Center / Server (Personal Access Token, Bearer Auth, REST API v2)
 */
export const JIRA_AUTH_MODES = ["cloud", "datacenter"] as const;
export type JiraAuthMode = (typeof JIRA_AUTH_MODES)[number];

/**
 * Schema for Jira connection configuration.
 * Supports both Jira Cloud and Jira Data Center (on-premise) deployments.
 * Uses configString with x-secret for API token encryption and automatic redaction.
 */
export const JiraConnectionConfigSchema = z
  .object({
    authMode: z
      .enum(JIRA_AUTH_MODES)
      .default("cloud")
      .describe("Authentication mode"),
    baseUrl: configString({}).url().describe("Jira base URL"),
    email: configString({
      "x-hidden-when": { authMode: ["datacenter"] },
    })
      .email()
      .optional()
      .describe("Jira user email"),
    apiToken: configString({ "x-secret": true }).describe(
      "API token or Personal Access Token",
    ),
  })
  .superRefine((data, ctx) => {
    if (data.authMode === "cloud" && !data.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Email is required for Jira Cloud connections",
        path: ["email"],
      });
    }
  });

export type JiraConnectionConfig = z.infer<typeof JiraConnectionConfigSchema>;

/** V1 connection config shape (before authMode was added) */
interface JiraConnectionConfigV1 {
  baseUrl: string;
  email: string;
  apiToken: string;
}

/**
 * Migration from v1 to v2: adds authMode field.
 * All existing connections were Jira Cloud, so we default to "cloud".
 */
const connectionConfigV1ToV2: Migration<
  JiraConnectionConfigV1,
  JiraConnectionConfig
> = {
  fromVersion: 1,
  toVersion: 2,
  description: "Add authMode field (default: cloud) for Data Center support",
  migrate: (data) => ({
    ...data,
    authMode: "cloud" as const,
  }),
};

/**
 * Resolver names for dynamic dropdowns.
 * Defined as constants to ensure consistency between schema and handler.
 */
export const JIRA_RESOLVERS = {
  PROJECT_OPTIONS: "projectOptions",
  ISSUE_TYPE_OPTIONS: "issueTypeOptions",
  PRIORITY_OPTIONS: "priorityOptions",
  FIELD_OPTIONS: "fieldOptions",
  /**
   * Workflow transitions available on a specific issue. Used by the
   * `jira.transition_issue` automation action — depends on
   * `connectionId` + `issueKey` so the cascading dropdown can offer
   * only the transitions currently valid for that issue.
   */
  TRANSITION_OPTIONS: "transitionOptions",
} as const;


/**
 * Create the Jira integration provider.
 * Uses the generic connection management system for site-wide Jira connections.
 * Connection access is provided through params/context at call time.
 */
export function createJiraProvider(): IntegrationProvider<JiraConnectionConfig> {
  return {
    id: "jira",
    displayName: "Jira",
    description: "Create Jira issues from integration events",
    icon: "Ticket",

    // Connection configuration schema for generic connection management
    connectionSchema: new Versioned({
      version: 2,
      schema: JiraConnectionConfigSchema,
      migrations: [connectionConfigV1ToV2],
    }),

    documentation: {
      setupGuide: `
## Jira Integration Setup

This integration supports both **Jira Cloud** and **Jira Data Center** (on-premise).

### Jira Cloud
1. Select **cloud** as the authentication mode.
2. Enter your Atlassian base URL (e.g., \`https://yourcompany.atlassian.net\`).
3. Enter your Jira user email and an [API token](https://id.atlassian.com/manage-profile/security/api-tokens).

### Jira Data Center (On-Premise)
1. Select **datacenter** as the authentication mode.
2. Enter your Jira Server base URL (e.g., \`https://jira.yourcompany.com\`).
3. Enter a [Personal Access Token (PAT)](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html) — no email is required.

### Template Syntax

Use double curly braces to reference event payload properties:
- \`{{payload.title}}\` - Direct property access
- \`{{payload.system.name}}\` - Nested property access

If a property is missing, the placeholder will be preserved in the output for debugging.
      `.trim(),
      examplePayload: JSON.stringify(
        {
          eventType: "incident.created",
          timestamp: "2024-01-15T10:30:00Z",
          payload: {
            title: "Database Connectivity Issue",
            description: "Unable to connect to production database",
            severity: "high",
            system: {
              id: "sys-123",
              name: "Production Database",
            },
          },
        },
        undefined,
        2,
      ),
    },

    /**
     * Get dynamic options for subscription configuration fields.
     * Provides cascading dropdowns: connection -> projects -> issueTypes -> priorities
     */
    async getConnectionOptions(
      params: GetConnectionOptionsParams,
    ): Promise<ConnectionOption[]> {
      const {
        connectionId,
        resolverName,
        context,
        getConnectionWithCredentials,
        logger,
      } = params;

      // Fetch the connection with credentials
      const connection = await getConnectionWithCredentials(connectionId);
      if (!connection) {
        return [];
      }

      // Type-safe config access
      const config = connection.config as JiraConnectionConfig;

      const client = createJiraClientFromConfig(config, logger);

      try {
        switch (resolverName) {
          case JIRA_RESOLVERS.PROJECT_OPTIONS: {
            const projects = await client.getProjects();
            return projects.map((p) => ({
              value: p.key,
              label: `${p.name} (${p.key})`,
            }));
          }

          case JIRA_RESOLVERS.ISSUE_TYPE_OPTIONS: {
            const projectKey = context?.projectKey as string | undefined;
            if (!projectKey) {
              return [];
            }
            const issueTypes = await client.getIssueTypes(projectKey);
            return issueTypes.map((t) => ({
              value: t.id,
              label: t.name,
            }));
          }

          case JIRA_RESOLVERS.PRIORITY_OPTIONS: {
            const priorities = await client.getPriorities();
            return priorities.map((p) => ({
              value: p.id,
              label: p.name,
            }));
          }

          case JIRA_RESOLVERS.TRANSITION_OPTIONS: {
            const issueKey = context?.issueKey as string | undefined;
            if (!issueKey) {
              // Without an issue key we can't fetch instance-specific
              // transitions. Return empty so the dropdown stays blank
              // until the operator fills in the upstream field.
              return [];
            }
            const transitions = await client.getTransitions(issueKey);
            return transitions.map((t) => ({
              value: t.id,
              label: t.to ? `${t.name} → ${t.to.name}` : t.name,
            }));
          }

          case JIRA_RESOLVERS.FIELD_OPTIONS: {
            const projectKey = context?.projectKey as string | undefined;
            const issueTypeId = context?.issueTypeId as string | undefined;
            if (!projectKey || !issueTypeId) {
              return [];
            }
            const fields = await client.getFields(projectKey, issueTypeId);
            // Filter out standard fields that are handled separately
            const excludedFields = new Set([
              "summary",
              "description",
              "priority",
              "issuetype",
              "project",
              "reporter",
              "assignee",
            ]);
            return fields
              .filter((f) => !excludedFields.has(f.key))
              .map((f) => ({
                value: f.key,
                label: `${f.name}${f.required ? " *" : ""}`,
              }));
          }

          default: {
            logger.error(`Unknown resolver name: ${resolverName}`);
            return [];
          }
        }
      } catch (error) {
        logger.error("Failed to get connection options", error);
        return [];
      }
    },

    /**
     * Test the connection configuration.
     */
    async testConnection(
      config: JiraConnectionConfig,
    ): Promise<TestConnectionResult> {
      const minimalLogger = {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      };

      const client = createJiraClientFromConfig(config, minimalLogger);
      return client.testConnection();
    },
  };
}

export type JiraProvider = ReturnType<typeof createJiraProvider>;
