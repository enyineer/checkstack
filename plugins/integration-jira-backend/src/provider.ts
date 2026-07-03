import { z } from "zod";
import {
  Versioned,
  configString,
  configSecret,
  type Migration,
} from "@checkstack/backend-api";
import type {
  IntegrationProvider,
  TestConnectionResult,
  ConnectionOption,
  GetConnectionOptionsParams,
} from "@checkstack/integration-backend";
import { extractErrorMessage } from "@checkstack/common";
import { pluginMetadata } from "@checkstack/integration-jira-common";
import type { JiraField } from "@checkstack/integration-jira-common";
import { createJiraClientFromConfig } from "./jira-client";

/**
 * Human-readable value TYPE for a Jira field, surfaced as the option's
 * `description` so the model (and the editor) know how to format the value:
 * e.g. `array of string (required)`, `number`, or `option; one of: High, Low`.
 * Without this the model knows the field key but guesses the value shape (e.g.
 * sends a bare string for `labels`, which Jira expects as an array).
 */
function describeFieldType(field: JiraField): string {
  const parts: string[] = [];
  const type = field.schema?.type;
  if (type === "array") {
    parts.push(field.schema?.items ? `array of ${field.schema.items}` : "array");
  } else if (type) {
    parts.push(type);
  }
  const allowed = (field.allowedValues ?? [])
    .map((v) => v.name ?? v.value ?? v.id)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  if (allowed.length > 0) {
    const shown = allowed.slice(0, 8).join(", ");
    parts.push(`one of: ${shown}${allowed.length > 8 ? ", ..." : ""}`);
  }
  if (field.required) parts.push("required");
  return parts.join("; ") || "unknown type";
}

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
    apiToken: configSecret({ id: "apiToken" }).describe(
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

/** Local provider id (namespaced on registration to `{pluginId}.{id}`). */
export const JIRA_PROVIDER_LOCAL_ID = "jira";

/**
 * Fully-qualified Jira provider id (`integration-jira.jira`). Derived from
 * the plugin's own `pluginMetadata` so it tracks the plugin id rather than a
 * hardcoded string. Automation actions set this as `connectionProviderId`
 * so the editor knows which integration provider backs their dropdowns, and
 * it matches the `qualifiedId` the integration provider registry assigns.
 */
export const JIRA_PROVIDER_QUALIFIED_ID = `${pluginMetadata.pluginId}.${JIRA_PROVIDER_LOCAL_ID}`;

/**
 * Resolver names for dynamic dropdowns.
 * Defined as constants to ensure consistency between schema and handler.
 */
export const JIRA_RESOLVERS = {
  /**
   * Site-wide Jira connections. Drives the connection picker on every Jira
   * action; the editor bridge resolves it via `listConnections` (no
   * connection is selected yet), not `getConnectionOptions`.
   */
  CONNECTION_OPTIONS: "connectionOptions",
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
    id: JIRA_PROVIDER_LOCAL_ID,
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
- \`{{payload.systemName}}\` - the affected system's name
- \`{{payload.systemId}}\` - its stable id (use this to correlate, e.g. a Jira label)

Platform events expose flat fields like \`systemId\` / \`systemName\` (there is no nested \`system\` object). Dot notation still drills into any genuinely nested object a payload provides.

If a property is missing, the placeholder will be preserved in the output for debugging.
      `.trim(),
      examplePayload: JSON.stringify(
        {
          eventType: "healthcheck.system_degraded",
          timestamp: "2024-01-15T10:30:00Z",
          payload: {
            systemId: "sys-123",
            systemName: "Production Database",
            previousStatus: "healthy",
            newStatus: "unhealthy",
            healthyChecks: 2,
            totalChecks: 5,
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
        logger.warn(
          `Jira options resolver "${resolverName}" found no connection for id "${connectionId}" - returning no options.`,
        );
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
              logger.debug(
                "Jira issueType options skipped: no projectKey selected yet.",
              );
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
              logger.debug(
                "Jira transition options skipped: no issueKey resolved yet.",
              );
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
              logger.debug(
                `Jira field options skipped: ${
                  projectKey ? "issueTypeId" : "projectKey"
                } not selected yet.`,
              );
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
            const options = fields
              .filter((f) => !excludedFields.has(f.key))
              .map((f) => ({
                value: f.key,
                label: `${f.name}${f.required ? " *" : ""}`,
                // Surface the field's value TYPE so the model formats the value
                // correctly (e.g. labels = "array of string", not a bare string).
                description: describeFieldType(f),
              }));
            // Deps were present but nothing came back: almost always a Jira API
            // shape/permission issue rather than a genuinely field-less issue
            // type. Make it visible instead of a silent empty dropdown.
            if (options.length === 0) {
              logger.warn(
                `Jira field options resolved to 0 selectable fields for project "${projectKey}", issueType "${issueTypeId}" (createmeta returned ${fields.length} field(s)). Check the connection's permissions and Jira deployment (cloud vs datacenter).`,
              );
            }
            return options;
          }

          default: {
            throw new Error(`Unknown Jira options resolver: "${resolverName}"`);
          }
        }
      } catch (error) {
        // Do NOT swallow into an empty dropdown - log with context and rethrow
        // so the integration layer surfaces a clear error to the operator
        // (otherwise a failing resolver is indistinguishable from "no options").
        logger.error(
          `Jira options resolver "${resolverName}" failed (connection "${connectionId}", context keys: ${
            context ? Object.keys(context).join(", ") || "none" : "none"
          }): ${extractErrorMessage(error, "Unknown error")}`,
        );
        throw error;
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
