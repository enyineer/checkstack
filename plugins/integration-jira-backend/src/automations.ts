/**
 * Jira artifact type + actions registered with the Automation platform.
 *
 * The `jira.issue` artifact type represents an issue created by an
 * upstream `jira.create_issue` action so a downstream
 * `jira.transition_issue` or `jira.add_comment` can reach it without
 * the operator pasting the issue key — this is the "close-Jira-on-
 * incident-resolve" showcase flow.
 */
import { z } from "zod";
import {
  configString,
  Versioned,
  type Logger,
} from "@checkstack/backend-api";
import type {
  ActionDefinition,
  ArtifactTypeDefinition,
} from "@checkstack/automation-backend";
import {
  connectionStoreRef,
  type ConnectionStore,
} from "@checkstack/integration-backend";
import { extractErrorMessage, qualifyAccessRuleId } from "@checkstack/common";
import { jiraAccess, pluginMetadata } from "@checkstack/integration-jira-common";

import { createJiraClientFromConfig } from "./jira-client";
import type { JiraConnectionConfig } from "./provider";
import { JIRA_RESOLVERS, JIRA_PROVIDER_QUALIFIED_ID } from "./provider";

// ─── jira.issue artifact type ──────────────────────────────────────────

const jiraIssueDataSchema = z.object({
  issueKey: z.string().describe("e.g. PROJ-123"),
  projectKey: z.string(),
  issueUrl: z.string().url(),
  id: z.string().describe("Jira's numeric internal id"),
  status: z.string().optional().describe("Status name at creation time"),
});

export const jiraIssueArtifactType: ArtifactTypeDefinition<
  z.infer<typeof jiraIssueDataSchema>
> = {
  id: "issue",
  displayName: "Jira Issue",
  description: "A Jira ticket created by an upstream action",
  schema: jiraIssueDataSchema,
};

// ─── jira.issue_search artifact type ───────────────────────────────────

const jiraIssueSearchHitSchema = z.object({
  key: z.string().describe("e.g. PROJ-123"),
  url: z.string().url(),
  status: z.string().optional().describe("Current status name"),
  summary: z.string().optional().describe("Issue summary"),
});

const jiraIssueSearchDataSchema = z.object({
  found: z.boolean().describe("True when at least one issue matched"),
  count: z.number().describe("Total number of matching issues"),
  issues: z
    .array(jiraIssueSearchHitSchema)
    .describe("Matching issues (capped by the action's maxResults)"),
  firstIssueKey: z
    .string()
    .optional()
    .describe("Key of the first match, if any"),
});

/**
 * Result of a read-only `search_issues` lookup. A downstream `choose` /
 * `condition_guard` can gate creation on
 * `{{ not artifacts.<actionId>.issue_search.found }}` so an automation
 * does not file a duplicate ticket.
 */
export const jiraIssueSearchArtifactType: ArtifactTypeDefinition<
  z.infer<typeof jiraIssueSearchDataSchema>
> = {
  id: "issue_search",
  displayName: "Jira Issue Search",
  description: "Result of a read-only Jira issue lookup",
  schema: jiraIssueSearchDataSchema,
};

// ─── Action configs ────────────────────────────────────────────────────

/**
 * Per-row schema for the additional-field mappings the operator can
 * attach to a `jira.create_issue` action. Mirrors the legacy
 * `DynamicJiraFieldMappingSchema` from the subscription editor — the
 * editor still pops the field-options dropdown driven by
 * `JIRA_RESOLVERS.FIELD_OPTIONS` (which depends on `projectKey` +
 * `issueTypeId`).
 *
 * Templates are rendered by the dispatch engine before `execute` runs,
 * so `value` is the already-resolved string at execution time.
 */
const jiraFieldMappingSchema = z.object({
  fieldKey: configString({
    "x-options-resolver": JIRA_RESOLVERS.FIELD_OPTIONS,
    "x-depends-on": ["connectionId", "projectKey", "issueTypeId"],
    "x-searchable": true,
  }).describe("Jira field"),
  value: configString({ "x-editor-types": ["raw"] }).describe("Field value"),
});

const jiraCreateIssueConfigSchema = z.object({
  connectionId: configString({
    "x-options-resolver": JIRA_RESOLVERS.CONNECTION_OPTIONS,
  }).describe("Jira connection"),
  projectKey: configString({
    "x-options-resolver": JIRA_RESOLVERS.PROJECT_OPTIONS,
    "x-depends-on": ["connectionId"],
  }).describe("Project key"),
  issueTypeId: configString({
    "x-options-resolver": JIRA_RESOLVERS.ISSUE_TYPE_OPTIONS,
    "x-depends-on": ["connectionId", "projectKey"],
  }).describe("Issue type"),
  summary: configString({ "x-editor-types": ["raw"] })
    .min(1)
    .describe("Issue summary"),
  description: configString({ "x-editor-types": ["raw"] })
    .optional()
    .describe("Issue description"),
  priorityId: configString({
    "x-options-resolver": JIRA_RESOLVERS.PRIORITY_OPTIONS,
    "x-depends-on": ["connectionId"],
  })
    .optional()
    .describe("Priority"),
  /**
   * Optional additional field mappings — replaces the legacy
   * `fieldMappings` from `JiraSubscriptionConfigSchema`. The operator
   * picks a Jira field from the cascading dropdown and provides a
   * template value (rendered before this action runs).
   */
  fieldMappings: z
    .array(jiraFieldMappingSchema)
    .optional()
    .describe("Additional Jira field mappings"),
});

const jiraTransitionIssueConfigSchema = z.object({
  connectionId: configString({
    "x-options-resolver": JIRA_RESOLVERS.CONNECTION_OPTIONS,
  }).describe("Jira connection"),
  /**
   * Explicit issue key. When omitted, the dispatch engine resolves it
   * from the upstream `jira.issue` artifact in the current run scope.
   */
  issueKey: configString({ "x-editor-types": ["raw"] })
    .optional()
    .describe("Jira issue key (defaults to upstream jira.issue)"),
  transitionId: configString({
    "x-options-resolver": JIRA_RESOLVERS.TRANSITION_OPTIONS,
    "x-depends-on": ["connectionId", "issueKey"],
  }).describe("Transition to apply"),
  comment: configString({ "x-editor-types": ["raw"] })
    .optional()
    .describe("Optional comment posted with the transition"),
});

const jiraAddCommentConfigSchema = z.object({
  connectionId: configString({
    "x-options-resolver": JIRA_RESOLVERS.CONNECTION_OPTIONS,
  }).describe("Jira connection"),
  issueKey: configString({ "x-editor-types": ["raw"] })
    .optional()
    .describe("Jira issue key (defaults to upstream jira.issue)"),
  body: configString({ "x-editor-types": ["raw"] })
    .min(1)
    .describe("Comment body"),
});

/**
 * Read-only issue search. The operator supplies a connection plus either
 * a structured query (project / status / summary contains) and/or a raw
 * JQL string; the action ANDs them and queries Jira's search endpoint.
 */
const jiraSearchIssuesConfigSchema = z
  .object({
    connectionId: configString({
      "x-options-resolver": JIRA_RESOLVERS.CONNECTION_OPTIONS,
    }).describe("Jira connection"),
    projectKey: configString({
      "x-options-resolver": JIRA_RESOLVERS.PROJECT_OPTIONS,
      "x-depends-on": ["connectionId"],
    })
      .optional()
      .describe("Restrict to a project"),
    status: configString({ "x-editor-types": ["raw"] })
      .optional()
      .describe('Match an exact status name (e.g. "Open")'),
    statusCategory: configString({ "x-editor-types": ["raw"] })
      .optional()
      .describe('Match a status category (e.g. "indeterminate" for in-progress)'),
    summaryContains: configString({ "x-editor-types": ["raw"] })
      .optional()
      .describe("Match issues whose summary contains this text"),
    jql: configString({ "x-editor-types": ["raw"] })
      .optional()
      .describe("Raw JQL, ANDed with the structured filters above"),
  })
  .superRefine((data, ctx) => {
    const hasStructured =
      [data.projectKey, data.status, data.statusCategory, data.summaryContains]
        .some((v) => typeof v === "string" && v.trim().length > 0);
    const hasJql = typeof data.jql === "string" && data.jql.trim().length > 0;
    if (!hasStructured && !hasJql) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Provide at least one filter (project, status, summary, or raw JQL)",
        path: ["jql"],
      });
    }
  });

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * Resolve a Jira issue key from explicit config or fall back to the
 * most recent upstream `jira.issue` artifact in the run scope.
 */
function resolveIssueKey(
  configKey: string | undefined,
  consumed: Record<string, unknown>,
): string | undefined {
  if (configKey && configKey.trim().length > 0) return configKey;
  const jiraIssue = consumed["issue"];
  if (
    jiraIssue &&
    typeof jiraIssue === "object" &&
    "issueKey" in jiraIssue &&
    typeof (jiraIssue as { issueKey: unknown }).issueKey === "string"
  ) {
    return (jiraIssue as { issueKey: string }).issueKey;
  }
  return;
}

async function loadJiraClient(
  connectionId: string,
  connectionStore: ConnectionStore,
  logger: Logger,
) {
  const connection = await connectionStore.getConnectionWithCredentials(
    connectionId,
  );
  if (!connection) {
    return { error: `Jira connection not found: ${connectionId}` as const };
  }
  const config = connection.config as JiraConnectionConfig;
  return { client: createJiraClientFromConfig(config, logger), config };
}

// ─── Actions ───────────────────────────────────────────────────────────

export function createJiraActions(): ActionDefinition<unknown, unknown>[] {
  // Each action resolves the connection store lazily inside `execute`
  // via `getService(connectionStoreRef)`. Doing it at execute time
  // (rather than baking it in at registration time) lets this plugin's
  // init run without consuming `connectionStoreRef` — important because
  // integration-backend registers that service inside its own `init()`,
  // so the topological sort can't statically order this plugin's init
  // after that.
  const createIssueAction: ActionDefinition<
    z.infer<typeof jiraCreateIssueConfigSchema>,
    z.infer<typeof jiraIssueDataSchema>
  > = {
    id: "create_issue",
    displayName: "Create Jira Issue",
    description: "Create a new issue in a Jira project",
    category: "Jira",
    icon: "Ticket",
    connectionProviderId: JIRA_PROVIDER_QUALIFIED_ID,
    requiredAccessRules: [qualifyAccessRuleId(pluginMetadata, jiraAccess.createIssue)],
    config: new Versioned({
      version: 1,
      schema: jiraCreateIssueConfigSchema,
    }),
    produces: "issue",
    execute: async ({ config, logger, getService }) => {
      const connectionStore = await getService(connectionStoreRef);
      const loaded = await loadJiraClient(
        config.connectionId,
        connectionStore,
        logger,
      );
      if ("error" in loaded) {
        return { success: false, error: loaded.error };
      }
      const { client, config: connConfig } = loaded;
      try {
        const additionalFields: Record<string, unknown> = {};
        for (const mapping of config.fieldMappings ?? []) {
          additionalFields[mapping.fieldKey] = mapping.value;
        }
        const result = await client.createIssue({
          projectKey: config.projectKey,
          issueTypeId: config.issueTypeId,
          summary: config.summary,
          description: config.description,
          priorityId: config.priorityId,
          additionalFields:
            Object.keys(additionalFields).length > 0
              ? additionalFields
              : undefined,
        });
        const issueUrl = `${connConfig.baseUrl.replace(/\/$/, "")}/browse/${result.key}`;
        logger.info(`Automation created Jira issue ${result.key}`);
        return {
          success: true,
          externalId: result.key,
          artifact: {
            issueKey: result.key,
            projectKey: config.projectKey,
            issueUrl,
            id: result.id,
          },
        };
      } catch (error) {
        const message = extractErrorMessage(error, "Unknown error");
        if (
          message.includes("429") ||
          message.toLowerCase().includes("rate limit")
        ) {
          return {
            success: false,
            error: `Rate limited by Jira: ${message}`,
            retryAfterMs: 60_000,
          };
        }
        return {
          success: false,
          error: `Failed to create Jira issue: ${message}`,
        };
      }
    },
  };

  const transitionIssueAction: ActionDefinition<
    z.infer<typeof jiraTransitionIssueConfigSchema>,
    z.infer<typeof jiraIssueDataSchema>
  > = {
    id: "transition_issue",
    displayName: "Transition Jira Issue",
    description: "Apply a workflow transition to an existing Jira issue",
    category: "Jira",
    icon: "ArrowRightLeft",
    connectionProviderId: JIRA_PROVIDER_QUALIFIED_ID,
    requiredAccessRules: [qualifyAccessRuleId(pluginMetadata, jiraAccess.transitionIssue)],
    config: new Versioned({
      version: 1,
      schema: jiraTransitionIssueConfigSchema,
    }),
    consumes: ["issue"],
    produces: "issue",
    execute: async ({ config, consumedArtifacts, logger, getService }) => {
      const issueKey = resolveIssueKey(config.issueKey, consumedArtifacts);
      if (!issueKey) {
        return {
          success: false,
          error:
            "No issueKey provided and no upstream jira.issue artifact in scope",
        };
      }
      const connectionStore = await getService(connectionStoreRef);
      const loaded = await loadJiraClient(
        config.connectionId,
        connectionStore,
        logger,
      );
      if ("error" in loaded) {
        return { success: false, error: loaded.error };
      }
      const { client, config: connConfig } = loaded;
      try {
        const result = await client.transitionIssue(
          issueKey,
          config.transitionId,
          config.comment,
        );
        const status = await client.getIssueStatus(issueKey);
        logger.info(
          result.alreadyApplied
            ? `Issue ${issueKey} already in target status — skipped`
            : `Transitioned ${issueKey} via ${config.transitionId}`,
        );
        const issueUrl = `${connConfig.baseUrl.replace(/\/$/, "")}/browse/${issueKey}`;
        return {
          success: true,
          externalId: issueKey,
          artifact: {
            issueKey,
            projectKey: issueKey.split("-")[0] ?? "",
            issueUrl,
            id: issueKey,
            status: status?.name,
          },
        };
      } catch (error) {
        const message = extractErrorMessage(error, "Unknown error");
        return {
          success: false,
          error: `Failed to transition Jira issue: ${message}`,
        };
      }
    },
  };

  const addCommentAction: ActionDefinition<
    z.infer<typeof jiraAddCommentConfigSchema>,
    { commentId: string; issueKey: string }
  > = {
    id: "add_comment",
    displayName: "Add Jira Comment",
    description: "Post a comment on an existing Jira issue",
    category: "Jira",
    icon: "MessageSquare",
    connectionProviderId: JIRA_PROVIDER_QUALIFIED_ID,
    requiredAccessRules: [qualifyAccessRuleId(pluginMetadata, jiraAccess.addComment)],
    config: new Versioned({
      version: 1,
      schema: jiraAddCommentConfigSchema,
    }),
    consumes: ["issue"],
    execute: async ({ config, consumedArtifacts, logger, getService }) => {
      const issueKey = resolveIssueKey(config.issueKey, consumedArtifacts);
      if (!issueKey) {
        return {
          success: false,
          error:
            "No issueKey provided and no upstream jira.issue artifact in scope",
        };
      }
      const connectionStore = await getService(connectionStoreRef);
      const loaded = await loadJiraClient(
        config.connectionId,
        connectionStore,
        logger,
      );
      if ("error" in loaded) {
        return { success: false, error: loaded.error };
      }
      const { client } = loaded;
      try {
        const result = await client.addComment(issueKey, config.body);
        logger.info(`Posted Jira comment ${result.id} on ${issueKey}`);
        return {
          success: true,
          externalId: result.id,
          artifact: { commentId: result.id, issueKey },
        };
      } catch (error) {
        const message = extractErrorMessage(error, "Unknown error");
        return {
          success: false,
          error: `Failed to add Jira comment: ${message}`,
        };
      }
    },
  };

  const searchIssuesAction: ActionDefinition<
    z.infer<typeof jiraSearchIssuesConfigSchema>,
    z.infer<typeof jiraIssueSearchDataSchema>
  > = {
    id: "search_issues",
    displayName: "Search Jira Issues",
    description:
      "Read-only lookup for matching Jira issues (e.g. check for an existing open ticket before creating one)",
    category: "Jira",
    icon: "Search",
    connectionProviderId: JIRA_PROVIDER_QUALIFIED_ID,
    requiredAccessRules: [qualifyAccessRuleId(pluginMetadata, jiraAccess.searchIssues)],
    config: new Versioned({
      version: 1,
      schema: jiraSearchIssuesConfigSchema,
    }),
    produces: "issue_search",
    execute: async ({ config, logger, getService }) => {
      const connectionStore = await getService(connectionStoreRef);
      const loaded = await loadJiraClient(
        config.connectionId,
        connectionStore,
        logger,
      );
      if ("error" in loaded) {
        return { success: false, error: loaded.error };
      }
      const { client } = loaded;
      try {
        const result = await client.searchIssues({
          jql: config.jql,
          projectKey: config.projectKey,
          status: config.status,
          statusCategory: config.statusCategory,
          summaryContains: config.summaryContains,
        });
        logger.info(
          `Jira search matched ${result.count} issue(s)` +
            (result.firstIssueKey ? ` (first: ${result.firstIssueKey})` : ""),
        );
        return {
          success: true,
          artifact: {
            found: result.found,
            count: result.count,
            issues: result.issues,
            firstIssueKey: result.firstIssueKey,
          },
        };
      } catch (error) {
        const message = extractErrorMessage(error, "Unknown error");
        if (
          message.includes("429") ||
          message.toLowerCase().includes("rate limit")
        ) {
          return {
            success: false,
            error: `Rate limited by Jira: ${message}`,
            retryAfterMs: 60_000,
          };
        }
        return {
          success: false,
          error: `Failed to search Jira issues: ${message}`,
        };
      }
    },
  };

  return [
    createIssueAction as ActionDefinition<unknown, unknown>,
    transitionIssueAction as ActionDefinition<unknown, unknown>,
    addCommentAction as ActionDefinition<unknown, unknown>,
    searchIssuesAction as ActionDefinition<unknown, unknown>,
  ];
}

