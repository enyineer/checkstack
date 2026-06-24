import type { AutomationTemplateInput } from "@checkstack/automation-common";

/**
 * Incident response: AI-triage a newly-degraded system, then file a Jira bug
 * only if no open ticket already exists for that system (dedup via search).
 * Requires the AI + Jira integrations.
 */
export const aiTriageFileJiraBug: AutomationTemplateInput = {
  id: "ai-triage-file-jira-bug",
  name: "AI triage and file Jira bug",
  description:
    "When a system becomes degraded, use AI to draft a Jira bug from the trigger payload, search Jira for an existing open ticket for that system, and create a new Bug only if none is found.",
  category: "Incident response",
  icon: "Ticket",
  definition: {
    name: "AI triage and file Jira bug",
    description:
      "AI triages an unhealthy system and files a Jira bug if no open ticket already exists.",
    triggers: [{ event: "healthcheck.system_degraded" }],
    conditions: [],
    actions: [
      {
        id: "triage",
        action: "automation.ai_analyze",
        config: {
          connectionId: "REPLACE_AI_CONNECTION",
          prompt:
            "A monitored system has become degraded. Draft a concise Jira bug report for the on-call engineer.\n\nSystem name: {{ trigger.payload.systemName }}\nSystem ID: {{ trigger.payload.systemId }}\nNew status: {{ trigger.payload.newStatus }}\nPrevious status: {{ trigger.payload.previousStatus }}\nHealthy checks: {{ trigger.payload.healthyChecks }} of {{ trigger.payload.totalChecks }}\nDetected at: {{ trigger.payload.timestamp }}\n\nWrite a short, specific bug title that names the affected system and the symptom. Write a clear description summarizing what changed, the impacted check counts, and suggested first investigation steps. Keep it factual and actionable.",
          outputFields: [
            {
              key: "title",
              type: "string",
              description:
                "Concise Jira bug title naming the degraded system and its symptom.",
            },
            {
              key: "description",
              type: "string",
              description:
                "Clear bug description summarizing the degradation, impacted check counts, and suggested first investigation steps.",
            },
          ],
        },
      },
      {
        id: "find_existing",
        action: "integration-jira.search_issues",
        config: {
          connectionId: "REPLACE_JIRA_CONNECTION",
          projectKey: "REPLACE_PROJECT",
          statusCategory: "indeterminate",
          // Correlate to THIS system by a stable label rather than fuzzy summary
          // text. `file_bug` below tags the issue with the same label on create.
          // `systemId` is always present on the trigger payload (unlike the
          // optional `systemName`), so the label never renders empty.
          labels: "checkstack-sys-{{ trigger.payload.systemId }}",
        },
      },
      {
        choose: [
          {
            // `when` is a BARE expression (no {{ }}): file the bug only when no
            // open ticket already exists for this system.
            when: "artifacts.find_existing.issue_search.found != true",
            sequence: [
              {
                id: "file_bug",
                action: "integration-jira.create_issue",
                config: {
                  connectionId: "REPLACE_JIRA_CONNECTION",
                  projectKey: "REPLACE_PROJECT",
                  issueTypeId: "REPLACE_ISSUE_TYPE",
                  summary: "{{ artifacts.triage.analysis.data.title }}",
                  description: "{{ artifacts.triage.analysis.data.description }}",
                  // Tag with the stable per-system label so the recovery
                  // automation (and future runs) can find this exact ticket.
                  fieldMappings: [
                    {
                      fieldKey: "labels",
                      value: "checkstack-sys-{{ trigger.payload.systemId }}",
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  },
};
