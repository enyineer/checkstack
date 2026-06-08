import { access } from "@checkstack/common";

import { pluginMetadata } from "./plugin-metadata";

/**
 * Per-action access rules for the Jira automation actions.
 *
 * An automation's `runAs` service account must hold the matching rule for the
 * dispatch engine to run that action - so creating Jira tickets (etc.) requires
 * a permission an admin grants to the service account's role, rather than being
 * implied by merely being able to author automations. Read-only `search_issues`
 * is a `read` rule; the mutating actions are `manage`.
 */
export const jiraAccess = {
  createIssue: access(
    "create_issue",
    "manage",
    "Create Jira issues from an automation",
    { pluginId: pluginMetadata.pluginId },
  ),
  searchIssues: access(
    "search_issues",
    "read",
    "Search Jira issues from an automation",
    { pluginId: pluginMetadata.pluginId },
  ),
  transitionIssue: access(
    "transition_issue",
    "manage",
    "Transition Jira issues from an automation",
    { pluginId: pluginMetadata.pluginId },
  ),
  addComment: access(
    "add_comment",
    "manage",
    "Comment on Jira issues from an automation",
    { pluginId: pluginMetadata.pluginId },
  ),
};

/** All Jira access rules, for registration via `env.registerAccessRules`. */
export const jiraAccessRules = Object.values(jiraAccess);
