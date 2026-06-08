import type { AutomationTemplateInput } from "@checkstack/automation-common";

/**
 * Incident response: AI-summarize a newly created incident into a one-line
 * headline plus a recommended first step, then notify a responder. Requires
 * the AI integration and the incident plugin.
 */
export const aiSummarizeNewIncident: AutomationTemplateInput = {
  id: "ai-summarize-new-incident",
  name: "AI summarize new incident and notify responder",
  description:
    "When an incident is created, use AI to write a short, plain-language summary from the incident details, then notify a responder with that summary and a recommended first step.",
  category: "Incident response",
  icon: "FileText",
  definition: {
    name: "AI summarize new incident and notify responder",
    description: "Summarizes a newly created incident with AI and notifies a responder.",
    triggers: [{ event: "incident.created" }],
    conditions: [],
    actions: [
      {
        id: "summarize",
        action: "automation.ai_analyze",
        config: {
          connectionId: "REPLACE_AI_CONNECTION",
          prompt:
            "An incident was just created. Write a concise, responder-friendly summary in plain language so an on-call engineer can grasp it at a glance. Title: {{ trigger.payload.title }}. Severity: {{ trigger.payload.severity }}. Description: {{ trigger.payload.description }}. Avoid jargon, keep it factual, and base your output only on the details provided.",
          outputFields: [
            {
              key: "summary_line",
              type: "string",
              description:
                "A single-line, plain-language headline summarizing the incident for a responder.",
            },
            {
              key: "recommended_first_step",
              type: "string",
              description:
                "One concrete, actionable first step the responder should take to begin triage.",
            },
          ],
        },
      },
      {
        id: "notify",
        action: "automation.notify_user",
        config: {
          userId: "REPLACE_USER",
          title: "New incident: {{ trigger.payload.title }}",
          body: "{{ artifacts.summarize.analysis.data.summary_line }}\n\nRecommended first step: {{ artifacts.summarize.analysis.data.recommended_first_step }}",
          importance: "warning",
        },
      },
    ],
  },
};
