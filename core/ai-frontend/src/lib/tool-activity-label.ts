/**
 * Map a raw tool id to a short, human-readable activity label for the chat UI.
 *
 * The model invokes tools by their provider-safe ids (e.g. `healthcheck_status`,
 * `ai.searchDocs`). Showing those verbatim in the turn ("ai_searchDocs
 * running...") is cryptic; a friendly verb phrase ("Searching documentation")
 * reads as the assistant narrating what it is doing. This is the "activity
 * label" half of the thinking-progress UI, kept as a pure, DOM-free function so
 * it is unit-testable without rendering.
 *
 * Tool ids arrive with either a dot or an underscore between the plugin
 * namespace and the action (the provider sanitises dots to underscores for some
 * gateways), so we normalise both before matching.
 */

/** Curated labels for the tools the assistant actually uses, by normalised id. */
const KNOWN_LABELS: Record<string, string> = {
  // Documentation grounding (ai-backend).
  ai_searchDocs: "Searching documentation",
  ai_listDocs: "Browsing documentation",
  ai_getDoc: "Reading documentation",
  ai_probeUrl: "Probing a URL",
  // Cross-cutting issue aggregation.
  system_issues: "Gathering system issues",
  // Health checks.
  healthcheck_status: "Checking health status",
  healthcheck_runHistory: "Reading health-check history",
  healthcheck_getScriptContext: "Loading script context",
  healthcheck_testScript: "Testing the script",
  healthcheck_propose: "Preparing a health check",
  // Reliability.
  slo_listObjectives: "Checking SLOs",
  anomaly_list: "Checking anomalies",
  // Operations.
  incident_list: "Checking incidents",
  maintenance_list: "Checking maintenances",
  catalog_listSystems: "Looking up the catalog",
  // Automations.
  automation_listCapabilities: "Discovering automation capabilities",
  automation_getCapabilitySchema: "Reading an action's schema",
  automation_listServiceAccounts: "Checking service accounts",
  automation_listConnections: "Checking connections",
  automation_getScriptContext: "Loading script context",
  automation_testScript: "Testing the script",
  automation_propose: "Preparing an automation",
};

/** Verb for a common action prefix, used to phrase an unmapped tool nicely. */
const ACTION_VERBS: Record<string, string> = {
  list: "Checking",
  get: "Reading",
  search: "Searching",
  propose: "Preparing",
  test: "Testing",
  run: "Running",
  create: "Creating",
  add: "Updating",
  update: "Updating",
  resolve: "Resolving",
  transition: "Updating",
  notify: "Notifying",
};

/** Split a camelCase / snake_case token into lowercased words. */
function toWords(text: string): string[] {
  return text
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/**
 * Returns a friendly present-tense label for a tool id, e.g.
 * `healthcheck_runHistory` -> "Reading health-check history". Falls back to a
 * humanised phrase derived from the action's leading verb for any tool not in
 * the curated map, so a newly added tool still reads sensibly without a code
 * change.
 */
export function toolActivityLabel(toolName: string): string {
  const normalised = toolName.replaceAll(".", "_");
  const known = KNOWN_LABELS[normalised];
  if (known) return known;

  // Derive: <namespace>_<action...>. Phrase from the action's leading verb.
  const sepIndex = normalised.indexOf("_");
  const action = sepIndex === -1 ? normalised : normalised.slice(sepIndex + 1);
  const words = toWords(action);
  if (words.length === 0) return toolName;
  const verb = ACTION_VERBS[words[0]];
  if (verb) {
    const rest = words.slice(1).join(" ");
    return rest ? `${verb} ${rest}` : verb;
  }
  // No recognised verb: present the humanised action as-is, capitalised.
  const phrase = words.join(" ");
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}
