import type { AutomationTemplateInput } from "@checkstack/automation-common";

/**
 * Incident response: when a system recovers, find its open Jira ticket, post a
 * recovery comment, and apply a workflow transition (e.g. to Done). Requires
 * the Jira integration.
 */
export const jiraCommentTransitionOnRecovery: AutomationTemplateInput = {
  id: "jira-comment-transition-on-recovery",
  name: "Close Jira ticket on recovery",
  description:
    "When a system returns to healthy, find its open Jira ticket, post a recovery comment, and transition the ticket to a resolved workflow state.",
  category: "Incident response",
  icon: "CircleCheck",
  definition: {
    name: "Close Jira ticket on recovery",
    description:
      "On healthcheck recovery, locate the matching open Jira issue, comment that the system recovered, and apply a workflow transition.",
    triggers: [{ event: "healthcheck.system_healthy" }],
    conditions: [],
    actions: [
      {
        id: "find_ticket",
        action: "integration-jira.search_issues",
        config: {
          connectionId: "REPLACE_JIRA_CONNECTION",
          projectKey: "REPLACE_PROJECT",
          statusCategory: "indeterminate",
          // Correlate to THIS system by the stable label the "file Jira bug"
          // automation tags issues with on create. `systemId` is always present
          // on the trigger payload, so the label never renders empty.
          labels: "checkstack-sys-{{ trigger.payload.systemId }}",
        },
      },
      {
        id: "close_if_found",
        choose: [
          {
            // `when` is a BARE expression (no {{ }}).
            when: "artifacts.find_ticket.issue_search.found == true",
            sequence: [
              {
                id: "post_comment",
                action: "integration-jira.add_comment",
                config: {
                  connectionId: "REPLACE_JIRA_CONNECTION",
                  issueKey: "{{ artifacts.find_ticket.issue_search.firstIssueKey }}",
                  body: "System {{ trigger.payload.systemName }} has recovered and is healthy again. Closing this ticket automatically.",
                },
              },
              {
                id: "transition",
                action: "integration-jira.transition_issue",
                config: {
                  connectionId: "REPLACE_JIRA_CONNECTION",
                  issueKey: "{{ artifacts.find_ticket.issue_search.firstIssueKey }}",
                  transitionId: "REPLACE_TRANSITION",
                },
              },
            ],
          },
        ],
      },
    ],
  },
};
