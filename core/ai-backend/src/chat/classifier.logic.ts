/**
 * Pure, DOM-free helpers for the cheap topical PRE-CLASSIFIER that runs before
 * the expensive agent/tool loop. The classifier asks a small model whether the
 * user's message is about operating Checkstack; an OFF_TOPIC verdict lets the
 * chat service short-circuit with a canned refusal INSTEAD of running the full
 * tool loop, saving generation + tool tokens.
 *
 * Both functions are total (never throw). The parser leans toward ON_TOPIC on
 * anything it does not clearly recognize as OFF_TOPIC: a false refusal of a real
 * ops question is worse than letting one off-topic request slide.
 */

/** The classifier's verdict. ON_TOPIC proceeds; OFF_TOPIC short-circuits. */
export type ClassifierVerdict = "ON_TOPIC" | "OFF_TOPIC";

/**
 * System prompt for the classifier. Kept tiny + deterministic: the model must
 * reply with a bare token so the (cheap) call stays short. The parser defends
 * against any decoration regardless.
 *
 * Deliberately a DENY-LIST, not an allow-list: it does NOT enumerate Checkstack
 * resources, tools, or verbs (those change constantly and must never require a
 * prompt edit). Everything is ON_TOPIC by default; only a few obviously
 * unrelated categories are rejected. This biases hard toward letting real ops
 * questions through.
 */
const CLASSIFIER_SYSTEM_PROMPT =
  "You are a topical gate for Checkstack, an operations and monitoring " +
  "assistant. Treat essentially EVERYTHING as ON_TOPIC by default - any " +
  "question or request about operating, analyzing, troubleshooting, " +
  "configuring, or reasoning about Checkstack, its data, systems, services, " +
  "environments, or their problems and status, any action on a resource, " +
  "questions about your own capabilities, and greetings. " +
  "Reply OFF_TOPIC ONLY when the message is CLEARLY unrelated to operating this " +
  "platform - that is ONLY: general-purpose programming/coding help, creative " +
  "writing, math or homework, or general trivia and world knowledge. " +
  "Everything else is ON_TOPIC. When in doubt, reply ON_TOPIC. Reply with the " +
  "token only.";

/**
 * The canned refusal returned (over the normal SSE stream) when the classifier
 * says OFF_TOPIC. Concise, with a one-line redirect. No em-dashes (user-facing).
 */
export const OFF_TOPIC_REFUSAL =
  "That looks outside my scope - I focus on Checkstack monitoring and " +
  "operations (incidents, health checks, anomalies, automations). " +
  "Try asking me about those, or ask \"what can you do?\" to see what I support.";

/**
 * Build the classifier prompt pair (system + user) for a given message. Pure so
 * the prompt shape is unit-testable without a model. The user message is passed
 * through verbatim as the prompt (the system prompt carries all instruction).
 */
export function buildClassifierPrompt({
  userText,
}: {
  userText: string;
}): { system: string; prompt: string } {
  return { system: CLASSIFIER_SYSTEM_PROMPT, prompt: userText };
}

/**
 * Parse the classifier's raw reply into a verdict. Returns OFF_TOPIC only when
 * the reply clearly says so (contains the OFF_TOPIC token and NOT the ON_TOPIC
 * token); everything else - ON_TOPIC, ambiguous, empty, or unrecognized -
 * defaults to ON_TOPIC (fail toward letting a real ops question through).
 */
export function parseClassifierVerdict(raw: string): ClassifierVerdict {
  const upper = raw.toUpperCase();
  const saysOff = upper.includes("OFF_TOPIC") || upper.includes("OFF-TOPIC");
  const saysOn = upper.includes("ON_TOPIC") || upper.includes("ON-TOPIC");
  // Only treat as OFF_TOPIC when the reply unambiguously says off and not on.
  if (saysOff && !saysOn) return "OFF_TOPIC";
  return "ON_TOPIC";
}
