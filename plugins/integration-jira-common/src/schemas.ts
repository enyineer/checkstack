import { z } from "zod";

// =============================================================================
// Jira Connection (Site-wide Configuration) - DEPRECATED
// Use the generic connection management system instead.
// =============================================================================

/**
 * Schema for a Jira Cloud connection configuration.
 * @deprecated Use generic connection management with JiraConnectionConfigSchema from jira-backend.
 */
export const JiraConnectionSchema = z.object({
  /** Unique identifier for this connection */
  id: z.string(),
  /** User-friendly name for the connection */
  name: z.string().min(1).max(100).describe("Connection name"),
  /** Jira Cloud base URL (e.g., https://yourcompany.atlassian.net) */
  baseUrl: z.string().url().describe("Jira Cloud base URL"),
  /** Email address for authentication */
  email: z.string().email().describe("Jira user email"),
  /** API token - will be marked as secret in backend */
  apiToken: z.string().min(1).describe("Jira API token"),
  /** Created timestamp */
  createdAt: z.coerce.date(),
  /** Updated timestamp */
  updatedAt: z.coerce.date(),
});

export type JiraConnection = z.infer<typeof JiraConnectionSchema>;

/**
 * Input for creating a new Jira connection.
 */
export const CreateJiraConnectionInputSchema = z.object({
  name: z.string().min(1).max(100),
  baseUrl: z.string().url(),
  email: z.string().email(),
  apiToken: z.string().min(1),
});

export type CreateJiraConnectionInput = z.infer<
  typeof CreateJiraConnectionInputSchema
>;

/**
 * Input for updating a Jira connection.
 * API token is optional - if not provided, existing token is preserved.
 */
export const UpdateJiraConnectionInputSchema = z.object({
  id: z.string(),
  updates: z.object({
    name: z.string().min(1).max(100).optional(),
    baseUrl: z.string().url().optional(),
    email: z.string().email().optional(),
    /** If provided, replaces the existing token */
    apiToken: z.string().min(1).optional(),
  }),
});

export type UpdateJiraConnectionInput = z.infer<
  typeof UpdateJiraConnectionInputSchema
>;

/**
 * Redacted connection for frontend display (no API token).
 */
export const JiraConnectionRedactedSchema = JiraConnectionSchema.omit({
  apiToken: true,
});

export type JiraConnectionRedacted = z.infer<
  typeof JiraConnectionRedactedSchema
>;

// =============================================================================
// Jira API Response Types
// =============================================================================

/**
 * Jira project from the API.
 */
export const JiraProjectSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  avatarUrls: z.record(z.string(), z.string()).optional(),
});

export type JiraProject = z.infer<typeof JiraProjectSchema>;

/**
 * Jira issue type from the API.
 */
export const JiraIssueTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  iconUrl: z.string().optional(),
  subtask: z.boolean(),
});

export type JiraIssueType = z.infer<typeof JiraIssueTypeSchema>;

/**
 * Jira field metadata from the API.
 */
export const JiraFieldSchema = z.object({
  key: z.string(),
  name: z.string(),
  required: z.boolean(),
  schema: z
    .object({
      type: z.string(),
      system: z.string().optional(),
      custom: z.string().optional(),
      customId: z.number().optional(),
    })
    .optional(),
  allowedValues: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        value: z.string().optional(),
      })
    )
    .optional(),
});

export type JiraField = z.infer<typeof JiraFieldSchema>;

// =============================================================================
// Jira Subscription Configuration (Per-subscription)
// =============================================================================

/**
 * Field mapping for template-based value population.
 */
export const JiraFieldMappingSchema = z.object({
  /** Jira field key */
  fieldKey: z.string(),
  /** Template string with {{payload.property}} placeholders */
  template: z.string(),
});

export type JiraFieldMapping = z.infer<typeof JiraFieldMappingSchema>;

/**
 * Provider configuration for Jira subscriptions.
 */
export const JiraSubscriptionConfigSchema = z.object({
  /** ID of the site-wide Jira connection to use */
  connectionId: z.string().describe("Jira connection to use"),
  /** Jira project key to create issues in */
  projectKey: z.string().describe("Project key"),
  /** Issue type ID for created issues */
  issueTypeId: z.string().describe("Issue type"),
  /** Summary template (required - uses {{payload.field}} syntax) */
  summaryTemplate: z.string().min(1).describe("Issue summary template"),
  /** Description template (optional) */
  descriptionTemplate: z
    .string()
    .optional()
    .describe("Issue description template"),
  /** Priority ID (optional) */
  priorityId: z.string().optional().describe("Priority"),
  /** Additional field mappings */
  fieldMappings: z
    .array(JiraFieldMappingSchema)
    .optional()
    .describe("Additional field mappings"),
});

export type JiraSubscriptionConfig = z.infer<
  typeof JiraSubscriptionConfigSchema
>;
