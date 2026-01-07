import { z } from "zod";
import {
  Versioned,
  secret,
  optionsResolver,
  hidden,
} from "@checkmate-monitor/backend-api";
import type {
  IntegrationProvider,
  IntegrationDeliveryContext,
  IntegrationDeliveryResult,
  TestConnectionResult,
  ConnectionOption,
  GetConnectionOptionsParams,
} from "@checkmate-monitor/integration-backend";
import { JiraFieldMappingSchema } from "@checkmate-monitor/integration-jira-common";
import { createJiraClient, createJiraClientFromConfig } from "./jira-client";
import { expandTemplate } from "./template-engine";

/**
 * Schema for Jira connection configuration.
 * Uses secret() for API token encryption and automatic redaction.
 */
export const JiraConnectionConfigSchema = z.object({
  baseUrl: z.string().url().describe("Jira Cloud base URL"),
  email: z.string().email().describe("Jira user email"),
  apiToken: secret({ description: "Jira API token" }),
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
} as const;

/**
 * Provider configuration for Jira subscriptions.
 * Uses optionsResolver() for dynamic dropdowns that fetch from Jira API.
 * Uses hidden() for connectionId which is auto-populated.
 */
export const JiraSubscriptionConfigSchema = z.object({
  /** ID of the site-wide Jira connection to use (auto-populated) */
  connectionId: hidden({ description: "Jira connection to use" }),
  /** Jira project key to create issues in */
  projectKey: optionsResolver({
    description: "Project key",
    resolver: JIRA_RESOLVERS.PROJECT_OPTIONS,
  }),
  /** Issue type ID for created issues */
  issueTypeId: optionsResolver({
    description: "Issue type",
    resolver: JIRA_RESOLVERS.ISSUE_TYPE_OPTIONS,
    dependsOn: ["projectKey"],
  }),
  /** Summary template (required - uses {{payload.field}} syntax) */
  summaryTemplate: z.string().min(1).describe("Issue summary template"),
  /** Description template (optional) */
  descriptionTemplate: z
    .string()
    .optional()
    .describe("Issue description template"),
  /** Priority ID (optional) */
  priorityId: optionsResolver({
    description: "Priority",
    resolver: JIRA_RESOLVERS.PRIORITY_OPTIONS,
  }).optional(),
  /** Additional field mappings */
  fieldMappings: z
    .array(JiraFieldMappingSchema)
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
            logger.debug("ISSUE_TYPE_OPTIONS context received", {
              context,
              projectKey: context?.projectKey,
            });
            const projectKey = context?.projectKey as string | undefined;
            if (!projectKey) {
              logger.warn("No projectKey in context, returning empty array");
              return [];
            }
            logger.debug(`Fetching issue types for project: ${projectKey}`);
            const issueTypes = await client.getIssueTypes(projectKey);
            logger.debug(`Got ${issueTypes.length} issue types`, {
              issueTypes,
            });
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
     * Test the subscription's connection configuration (deprecated method).
     * Connection testing is now done via the testConnection endpoint which
     * calls testConnection(config) directly.
     */
    async testConnection(
      config: JiraProviderConfig
    ): Promise<TestConnectionResult> {
      // When called from the generic test endpoint, config is actually the connection config
      // Cast to connection config and test
      const connectionConfig = config as unknown as JiraConnectionConfig;

      const minimalLogger = {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      };

      const client = createJiraClientFromConfig(
        connectionConfig,
        minimalLogger
      );
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
