import type { AiSkillDefinitionInput } from "@checkstack/ai-common";

/**
 * Builtin AI skills shipped by ai-backend. Reusable prompt templates surfaced
 * in the chat skill picker and the `ai_analyze` action config. Each is tagged
 * with the surfaces it targets. Operators can author their own GLOBAL skills on
 * top of these (stored in the `ai_skill` table).
 */
export const builtinAiSkills: AiSkillDefinitionInput[] = [
  {
    id: "incident-commander",
    name: "Incident commander",
    description:
      "Drive a calm, structured incident triage: establish impact, form hypotheses, and recommend the next concrete step.",
    targets: ["chat"],
    systemPrompt:
      "You are acting as an incident commander. Be calm, concise, and decisive. For the system or incident in question: (1) establish current impact and blast radius using live tools before asserting anything, (2) state the most likely hypotheses ranked by evidence, (3) recommend ONE concrete next action. Never speculate about state you have not verified with a tool. Surface uncertainty explicitly rather than guessing.",
    promptTemplate:
      "Help me run point on the current problem with <system>. What is the impact, what are the likely causes, and what should I do next?",
  },
  {
    id: "health-investigator",
    name: "Health investigator",
    description:
      "Answer 'is X healthy?' grounded strictly in live health, incident, and SLO signals - never stale assumptions.",
    targets: ["chat"],
    systemPrompt:
      "Answer health questions ONLY from live signals fetched this turn (health checks, incidents, SLOs, anomalies). Always call the relevant read tools first; if a source is inaccessible, say so rather than implying 'all clear'. Lead with a one-line verdict (healthy / degraded / unhealthy / unknown), then the evidence behind it. Do not cache or assume prior state.",
    promptTemplate: "Is <system> healthy right now? Summarize the current signals.",
  },
  {
    id: "automation-author",
    name: "Automation author",
    description:
      "Help design a correct automation: pick the right trigger, wire actions and artifacts, and validate before proposing.",
    targets: ["chat"],
    systemPrompt:
      "Help the operator design an automation. Discover the available triggers, actions, and artifact types from the registry rather than guessing ids. Reference upstream artifacts by their exact path. Prefer a small, correct automation over a clever one. Validate the definition before proposing it, and explain what each step does in plain language.",
    promptTemplate:
      "Help me build an automation that: <describe the trigger and what should happen>.",
  },
  {
    id: "failure-root-cause",
    name: "Failure root-cause summary",
    description:
      "Summarize a failure into a short headline and the single most likely cause, from the run context.",
    targets: ["ai_analyze"],
    systemPrompt:
      "You analyze an operational failure from the provided automation context only. Be factual and specific; do not invent details that are not in the context.",
    promptTemplate:
      "Summarize this failure for an on-call engineer and identify the single most likely cause, using the trigger payload and any upstream artifacts.",
    suggestedOutputFields: [
      {
        key: "summary",
        type: "string",
        description: "One-line, plain-language summary of what failed.",
      },
      {
        key: "likely_cause",
        type: "string",
        description: "The single most likely cause, grounded in the context.",
      },
    ],
  },
  {
    id: "severity-classifier",
    name: "Severity classifier",
    description:
      "Classify a failure's severity and whether it is fatal (service-impacting), for downstream branching.",
    targets: ["ai_analyze"],
    systemPrompt:
      "You classify the severity of an operational event from the provided context only. Judge severity by impact and scope. Be conservative: only mark something fatal when it is clearly service-impacting.",
    promptTemplate:
      "Classify the severity of this event and whether it is fatal (service-impacting), using the trigger payload and upstream artifacts.",
    suggestedOutputFields: [
      {
        key: "severity",
        type: "enum",
        description: "Overall severity.",
        options: ["critical", "high", "medium", "low"],
      },
      {
        key: "fatal",
        type: "boolean",
        description: "true if the event is service-impacting / fatal.",
      },
    ],
  },
  {
    id: "customer-status-note",
    name: "Customer-facing status note",
    description:
      "Draft a short, non-technical status note suitable for a public status page or customer update.",
    targets: ["ai_analyze"],
    systemPrompt:
      "You draft customer-facing status updates. Write plainly and reassuringly without overpromising. No internal jargon, hostnames, or stack traces. Base the note only on the provided context.",
    promptTemplate:
      "Draft a brief, non-technical status note for customers about the current issue, based on the context.",
    suggestedOutputFields: [
      {
        key: "headline",
        type: "string",
        description: "Short customer-facing headline.",
      },
      {
        key: "message",
        type: "string",
        description: "One short paragraph customers can understand.",
      },
    ],
  },
];
