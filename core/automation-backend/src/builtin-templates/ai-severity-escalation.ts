import type { AutomationTemplateInput } from "@checkstack/automation-common";

/**
 * Alerting: have AI classify a degraded system's failure (fatal? what
 * severity?), then branch - page critically for fatal failures, otherwise log
 * an informational note. Requires the AI integration.
 */
export const aiSeverityEscalation: AutomationTemplateInput = {
  id: "ai-severity-escalation",
  name: "AI severity escalation",
  description:
    "When a system degrades, an AI classifies whether the failure is fatal and assigns a severity. Fatal failures page a responder critically, while non-fatal degradations are logged as an informational note.",
  category: "Alerting",
  icon: "Siren",
  definition: {
    name: "Escalate by AI-classified severity",
    description:
      "Classify a degraded system's failure with AI, then page critically when fatal or log an informational note otherwise.",
    triggers: [{ event: "healthcheck.system_degraded" }],
    conditions: [],
    actions: [
      {
        id: "classify",
        action: "automation.ai_analyze",
        config: {
          connectionId: "REPLACE_AI_CONNECTION",
          prompt:
            "A monitored system named '{{ trigger.payload.systemName }}' (id {{ trigger.payload.systemId }}) just changed health status from {{ trigger.payload.previousStatus }} to {{ trigger.payload.newStatus }}. Of its {{ trigger.payload.totalChecks }} health checks, {{ trigger.payload.healthyChecks }} are currently healthy. Classify this degradation: determine whether the failure is fatal (service-impacting) and assign an overall severity. Base your judgment on how many checks are failing relative to the total and the transition between statuses.",
          outputFields: [
            {
              key: "fatal",
              type: "boolean",
              description: "true if this outage is service-impacting / fatal",
            },
            {
              key: "severity",
              type: "enum",
              description: "Overall severity of the degradation",
              options: ["critical", "high", "medium", "low"],
            },
          ],
        },
      },
      {
        choose: [
          {
            when: "{{ artifacts.classify.analysis.data.fatal }}",
            sequence: [
              {
                id: "page",
                action: "automation.notify_user",
                config: {
                  userId: "REPLACE_USER",
                  title: "FATAL: {{ trigger.payload.systemName }} degraded",
                  body: "AI classified this degradation as fatal with severity {{ artifacts.classify.analysis.data.severity }}. Summary: {{ artifacts.classify.analysis.summary }}",
                  importance: "critical",
                },
              },
            ],
          },
        ],
        else: [
          {
            id: "record",
            action: "automation.log",
            config: {
              message:
                "Non-fatal degradation on {{ trigger.payload.systemName }} (severity {{ artifacts.classify.analysis.data.severity }})",
              level: "info",
            },
          },
        ],
      },
    ],
  },
};
