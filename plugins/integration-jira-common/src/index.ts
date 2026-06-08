// Plugin Metadata
export { pluginMetadata } from "./plugin-metadata";

// Per-action access rules (a runAs service account must hold these to run the action)
export { jiraAccess, jiraAccessRules } from "./access";

// API response schemas
export {
  JiraProjectSchema,
  type JiraProject,
  JiraIssueTypeSchema,
  type JiraIssueType,
  JiraFieldSchema,
  type JiraField,
} from "./schemas";

// Note: a Jira-specific RPC contract (`jiraContract` / `JiraApi`) used
// to live here for connection-CRUD endpoints, but it was never
// registered with the backend router and had zero client consumers.
// Connection management goes through the generic integration contract
// in `@checkstack/integration-common`; nothing Jira-specific is
// served over RPC today.
