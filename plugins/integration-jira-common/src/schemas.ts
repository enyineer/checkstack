import { z } from "zod";

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
      /** Element type for `type: "array"` fields (e.g. "string" for labels). */
      items: z.string().optional(),
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
      }),
    )
    .optional(),
});

export type JiraField = z.infer<typeof JiraFieldSchema>;

// Note: the per-subscription `JiraSubscriptionConfigSchema` /
// `JiraFieldMappingSchema` (with their inferred types) used to live
// here too, but they were duplicated in `jira-backend/src/provider.ts`
// (which has the canonical, metadata-tagged version actually
// registered with the provider system). A repo-wide audit found zero
// external consumers of the common copies, so they were removed to
// eliminate the drift risk.
