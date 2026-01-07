// Plugin Metadata
export { pluginMetadata } from "./plugin-metadata";

// Schemas
export {
  // Legacy connection schemas (deprecated - use generic connection management)
  JiraConnectionSchema,
  type JiraConnection,
  CreateJiraConnectionInputSchema,
  type CreateJiraConnectionInput,
  UpdateJiraConnectionInputSchema,
  type UpdateJiraConnectionInput,
  JiraConnectionRedactedSchema,
  type JiraConnectionRedacted,
  // API response schemas
  JiraProjectSchema,
  type JiraProject,
  JiraIssueTypeSchema,
  type JiraIssueType,
  JiraFieldSchema,
  type JiraField,
  // Subscription config schemas
  JiraFieldMappingSchema,
  type JiraFieldMapping,
  JiraSubscriptionConfigSchema,
  type JiraSubscriptionConfig,
} from "./schemas";

// RPC Contract
export { jiraContract, JiraApi, type JiraContract } from "./rpc-contract";
