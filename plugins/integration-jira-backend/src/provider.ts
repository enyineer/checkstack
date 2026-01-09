import { z } from "zod";
import { Versioned, configString } from "@checkmate-monitor/backend-api";
import type {
  IntegrationProvider,
  IntegrationDeliveryContext,
  IntegrationDeliveryResult,
  TestConnectionResult,
  ConnectionOption,
  GetConnectionOptionsParams,
} from "@checkmate-monitor/integration-backend";
import { createJiraClient, createJiraClientFromConfig } from "./jira-client";
import { expandTemplate } from "./template-engine";

/**
 * Schema for Jira connection configuration.
 * Uses configString with x-secret for API token encryption and automatic redaction.
 */
export const JiraConnectionConfigSchema = z.object({
  baseUrl: configString({}).url().describe("Jira Cloud base URL"),
  email: configString({}).email().describe("Jira user email"),
  apiToken: configString({ "x-secret": true }).describe("Jira API token"),
});

export type JiraConnectionConfig = z.infer<typeof JiraConnectionConfigSchema>;

/**
 * Resolver names for dynamic dropdowns.
 * Defined as constants to ensure consistency between schema and handler.
 */
export const JIRA_RESOLVERS = {
  PROJECT_OPTIONS: "projectOptions",
  ISSUE_TYPE_OPTIONS: "issueTypeOptions",
  PRIORITY_OPTIONS: "priorityOptions",
  FIELD_OPTIONS: "fieldOptions",
} as const;

/**
 * Dynamic field mapping schema with options resolver for field key.
 * Uses configString with x-options-resolver to fetch available fields from Jira.
 */
export const DynamicJiraFieldMappingSchema = z.object({
  /** Jira field key - fetched dynamically from Jira */
  fieldKey: configString({
    "x-options-resolver": JIRA_RESOLVERS.FIELD_OPTIONS,
    "x-depends-on": ["projectKey", "issueTypeId"],
    "x-searchable": true,
  }).describe("Jira field"),
  /** Template string with {{payload.property}} placeholders */
  template: configString({}).describe("Template value"),
});

/**
 * Provider configuration for Jira subscriptions.
 * Uses configString with x-options-resolver for dynamic dropdowns.
 * Uses configString with x-hidden for connectionId which is auto-populated.
 */
export const JiraSubscriptionConfigSchema = z.object({
  /** ID of the site-wide Jira connection to use (auto-populated) */
  connectionId: configString({ "x-hidden": true }).describe(
    "Jira connection to use"
  ),
  /** Jira project key to create issues in */
  projectKey: configString({
    "x-options-resolver": JIRA_RESOLVERS.PROJECT_OPTIONS,
  }).describe("Project key"),
  /** Issue type ID for created issues */
  issueTypeId: configString({
    "x-options-resolver": JIRA_RESOLVERS.ISSUE_TYPE_OPTIONS,
    "x-depends-on": ["projectKey"],
  }).describe("Issue type"),
  /** Summary template (required - uses {{payload.field}} syntax) */
  summaryTemplate: configString({}).min(1).describe("Issue summary template"),
  /** Description template (optional) */
  descriptionTemplate: configString({})
    .optional()
    .describe("Issue description template"),
  /** Priority ID (optional) */
  priorityId: configString({
    "x-options-resolver": JIRA_RESOLVERS.PRIORITY_OPTIONS,
  })
    .describe("Priority")
    .optional(),
  /** Additional field mappings */
  fieldMappings: z
    .array(DynamicJiraFieldMappingSchema)
    .optional()
    .describe("Additional field mappings"),
});

/**
 * Jira subscription config type.
 */
export type JiraProviderConfig = z.infer<typeof JiraSubscriptionConfigSchema>;

/**
 * Create the Jira integration provider.
 * Uses the generic connection management system for site-wide Jira connections.
 * Connection access is provided through params/context at call time.
 */
export function createJiraProvider(): IntegrationProvider<
  JiraProviderConfig,
  JiraConnectionConfig
> {
  return {
    id: "jira",
    displayName: "Jira",
    description: "Create Jira issues from integration events",
    icon: "Ticket",

    // Subscription configuration schema
    config: new Versioned({
      version: 1,
      schema: JiraSubscriptionConfigSchema,
    }),

    // Connection configuration schema for generic connection management
    connectionSchema: new Versioned({
      version: 1,
      schema: JiraConnectionConfigSchema,
    }),

    documentation: {
      setupGuide: `
## Jira Integration Setup

1. **Create a Jira Connection**: First, set up a site-wide Jira connection with your Atlassian credentials.
2. **Configure the Subscription**: Select your connection, project, and issue type.
3. **Set Up Templates**: Use \`{{payload.property}}\` syntax to dynamically populate issue fields from event data.

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
        2
      ),
    },

    /**
     * Get dynamic options for subscription configuration fields.
     * Provides cascading dropdowns: connection -> projects -> issueTypes -> priorities
     */
    async getConnectionOptions(
      params: GetConnectionOptionsParams
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
      config: JiraConnectionConfig
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

    /**
     * Deliver an event by creating a Jira issue.
     */
    async deliver(
      context: IntegrationDeliveryContext<JiraProviderConfig>
    ): Promise<IntegrationDeliveryResult> {
      const { providerConfig, event, logger } = context;
      const {
        connectionId,
        projectKey,
        issueTypeId,
        summaryTemplate,
        descriptionTemplate,
        priorityId,
        fieldMappings,
      } = providerConfig;

      // Get the connection with credentials from the delivery context
      if (!context.getConnectionWithCredentials) {
        return {
          success: false,
          error: "Connection access not available in delivery context",
        };
      }
      const connection = await context.getConnectionWithCredentials(
        connectionId
      );
      if (!connection) {
        return {
          success: false,
          error: `Jira connection not found: ${connectionId}`,
        };
      }

      // Type-safe config access
      const config = connection.config as JiraConnectionConfig;

      // Create Jira client
      const client = createJiraClient({
        baseUrl: config.baseUrl,
        email: config.email,
        apiToken: config.apiToken,
        logger,
      });

      // Expand templates using the event payload
      const payload = event.payload as Record<string, unknown>;
      const summary = expandTemplate(summaryTemplate, payload);
      const description = descriptionTemplate
        ? expandTemplate(descriptionTemplate, payload)
        : undefined;

      // Build additional fields from field mappings
      const additionalFields: Record<string, unknown> = {};
      if (fieldMappings) {
        for (const mapping of fieldMappings) {
          const value = expandTemplate(mapping.template, payload);
          additionalFields[mapping.fieldKey] = value;
        }
      }

      try {
        // Create the issue
        const result = await client.createIssue({
          projectKey,
          issueTypeId,
          summary,
          description,
          priorityId,
          additionalFields:
            Object.keys(additionalFields).length > 0
              ? additionalFields
              : undefined,
        });

        logger.info(`Created Jira issue: ${result.key}`, {
          issueId: result.id,
          issueKey: result.key,
          project: projectKey,
        });

        return {
          success: true,
          externalId: result.key,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        logger.error(`Failed to create Jira issue: ${message}`, { error });

        // Check if it's a rate limit error
        if (
          message.includes("429") ||
          message.toLowerCase().includes("rate limit")
        ) {
          return {
            success: false,
            error: `Rate limited by Jira: ${message}`,
            retryAfterMs: 60_000, // Retry after 1 minute
          };
        }

        return {
          success: false,
          error: `Failed to create Jira issue: ${message}`,
        };
      }
    },
  };
}

export type JiraProvider = ReturnType<typeof createJiraProvider>;
