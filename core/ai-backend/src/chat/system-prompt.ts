/**
 * System-prompt assembly for the chat agent loop.
 *
 * Kept in its own DOM/dep-free module so the prompt text - and especially the
 * timezone handling, which is correctness-sensitive - is unit-testable without
 * standing up the whole chat service.
 */

/** The base instruction set: what the assistant is and how it uses tools. */
export const CHAT_SYSTEM_PROMPT =
  "You are Checkstack's built-in assistant. You ONLY help operators run " +
  "Checkstack: incidents, health checks, anomalies, automations, and the " +
  "monitoring and operations of THIS platform. Use the provided tools to read " +
  "live data. For any change to the platform, call the appropriate tool: " +
  "depending on the conversation's permission mode it either returns a " +
  "confirmation card the operator must approve, or applies immediately and " +
  "returns the applied result. Never claim a change took effect until the tool " +
  "result confirms it (an applied result, or the operator approving the card). " +
  "Call each change tool ONCE per request: a confirm-card result means the " +
  "proposal succeeded and is awaiting the operator - do NOT call the tool again " +
  "to retry; just tell the operator you are waiting for their decision. " +
  "Politely DECLINE anything unrelated to operating Checkstack " +
  "(general coding help, writing, or general knowledge) with a one-line " +
  "redirect back to Checkstack monitoring and operations. Be concise and " +
  "engineering-focused.";

/**
 * How to answer "are there any issues?" thoroughly, and how to pass ids.
 *
 * The model tends to answer from the first source that returns something (e.g.
 * report an SLO breach and stop, missing a failing health check). It also tends
 * to pass a system NAME, an invented id, or a made-up filter value where a tool
 * wants a real id/enum - which fails validation. This block makes both
 * behaviours explicit. Tool names are the provider-safe ids the model is given.
 */
export const INVESTIGATION_INSTRUCTION =
  "When the operator asks whether there are issues/problems, what is wrong, or " +
  "what is down/failing/breaching, do NOT answer from a single source. Prefer " +
  "the system_issues tool, which aggregates ALL current problems (failing " +
  "health checks, breaching/at-risk SLOs, active anomalies, open incidents, " +
  "active maintenances, dependency problems) across every system in one call. " +
  "If it is unavailable, instead check ALL of these and report a consolidated " +
  "summary: failing health checks (healthcheck_status), breaching or at-risk " +
  "SLOs (slo_listObjectives), active anomalies (anomaly_list), and open " +
  "incidents (incident_list). Do not stop after the first source that returns " +
  "something; an empty result from one source does not mean there are no issues " +
  "in another. " +
  "Many tools take a systemId, which MUST be a system's UUID: if the operator " +
  "names a system, first resolve it to its id with the catalog tool, then pass " +
  "that id. Pass ids and enum filter values EXACTLY as a tool returned or as a " +
  "tool's description lists them - never invent an id, and never pass a filter " +
  "value (such as a state) that the tool does not document.";

/**
 * How to build a WORKING automation instead of a plausible-looking one.
 *
 * The model's failure mode is fabricating values it should source from the
 * platform: a runAs service account that does not exist, a hand-rolled HTTP
 * fetch to an integrated system with a placeholder URL/token, and a script
 * whose return value is never wired downstream. This block forces discovery
 * before drafting, real ids from the listing tools, integration actions over
 * hand-rolled HTTP, side-effect-free decisions, and validation before propose.
 * Deliberately names only the discovery tools - never enumerate resource or
 * action types here, so this text need not change when capabilities change.
 */
export const AUTOMATION_BUILDING_INSTRUCTION =
  "When building or editing an automation, do NOT draft action configs from " +
  "memory. First discover what is available: call automation.listCapabilities, " +
  "then automation.getCapabilitySchema for each action you intend to use, and " +
  "shape every config to that schema. " +
  "Pick a runAs from automation.listServiceAccounts and use one of those ids " +
  "verbatim - NEVER invent a service account (values like \"system\" are not " +
  "service accounts and will be rejected). " +
  "For a system Checkstack integrates with, use that integration's actions " +
  "with a REAL connectionId from automation.listConnections - never hand-roll " +
  "an HTTP fetch to an integrated system, and never invent a connectionId. " +
  "Model a decision or gate (e.g. \"only if there is no open ticket\") as a " +
  "choose or condition over a prior QUERY action's artifact - conditions are " +
  "side-effect-free, so never express a gate as an action that also performs " +
  "I/O. " +
  "For a system Checkstack does NOT integrate with, write a script action that " +
  "fetches the API using secrets for auth (declare them in secretEnv and read " +
  "them from process.env) and variables from an upstream variables action for " +
  "the URL and params - never hardcode a URL or token and never leave a " +
  "placeholder; also tell the operator the script needs egress allowlisted to " +
  "that host. " +
  "Give every action that produces output an id and wire it downstream with " +
  "the FULL path {{ artifacts.<actionId>.<artifactType>.<field> }}. The " +
  "<artifactType> segment is REQUIRED and easy to drop: it is the action's " +
  "produced artifact type (see automation.getCapabilitySchema), e.g. a search " +
  "action that produces issue_search is read as " +
  "{{ artifacts.<actionId>.issue_search.found }}, NOT " +
  "{{ artifacts.<actionId>.found }} (which silently resolves to undefined and " +
  "makes any gate misfire). A script action's return value surfaces under " +
  "script_result.result, so read it as " +
  "{{ artifacts.<actionId>.script_result.result.<field> }}. " +
  "Validate any script with automation.testScript before calling " +
  "automation.propose.";

/**
 * The date-time wire contract, stated to the model so it emits an offset the
 * first time instead of learning via a rejected tool call. Enforced server-side
 * by `collectDateOffsetIssues` regardless - this is the cooperative half.
 */
export const DATE_FORMAT_INSTRUCTION =
  "Always emit date-time tool arguments as RFC 3339 with an EXPLICIT timezone " +
  'offset (e.g. "2026-07-01T22:00:00Z" or "2026-07-01T22:00:00+02:00"); never ' +
  "send a zone-less or date-only value.";

/**
 * Is `timeZone` a real IANA zone id (e.g. `Europe/Berlin`)? Validated by handing
 * it to `Intl`, which rejects anything that is not a canonical zone id. This is
 * also the injection guard: only constrained zone ids pass, so the untrusted
 * client-supplied string can never smuggle arbitrary text into the prompt.
 */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The host/container's IANA timezone (respects the container's `TZ` env var).
 * Used as the reference zone when the client did not send one - e.g. a headless
 * run, or a browser without `Intl`. This matches operator expectations on a
 * self-hosted deployment configured to a local zone, rather than silently
 * defaulting to UTC. Falls back to `"UTC"` only if `Intl` itself is unavailable.
 */
export function hostTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Render an instant as a human wall-clock string in `timeZone`, e.g.
 * `Saturday 2026-06-07 00:45 (GMT+02:00)`. Gives the model the local time AND
 * its offset so it can resolve "today at 10:00" into the correct instant.
 */
export function formatInstantInZone({
  now,
  timeZone,
}: {
  now: Date;
  timeZone: string;
}): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "longOffset",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return (
    `${get("weekday")} ${get("year")}-${get("month")}-${get("day")} ` +
    `${get("hour")}:${get("minute")} (${get("timeZoneName")})`
  );
}

/**
 * The shared date/time context appended to any model prompt that can emit dates:
 * the reference zone for bare times, the CURRENT instant (the model has no
 * clock) so it can resolve "today"/"tomorrow", and the offset wire contract.
 * `audience` only tweaks the wording (a human operator vs. an unattended run).
 */
export function buildDateTimeContext({
  timeZone,
  now,
  audience,
}: {
  timeZone?: string;
  now?: Date;
  audience: "operator" | "headless";
}): string {
  const zone =
    (timeZone && isValidTimeZone(timeZone) ? timeZone : undefined) ??
    hostTimeZone();
  const at = now ?? new Date();
  const subject = audience === "operator" ? "the operator mentions" : "you use";
  return (
    `Interpret any time ${subject} WITHOUT an explicit zone as being in the ` +
    `${zone} timezone. The current time is ${at.toISOString()} (that is ` +
    `${formatInstantInZone({ now: at, timeZone: zone })} in ${zone}); use it to ` +
    `resolve relative dates like "today", "tomorrow" or "in 2 hours". ` +
    DATE_FORMAT_INSTRUCTION
  );
}

/**
 * Build the chat system prompt, folding in the reference timezone used to turn
 * an operator's bare "22:00" into an offset-bearing instant and the current
 * time. Prefers the operator's browser zone; falls back to the host/container
 * zone (NOT UTC) when the client sent none or an invalid one.
 */
export function buildChatSystemPrompt({
  timeZone,
  now,
}: {
  timeZone?: string;
  now?: Date;
}): string {
  return `${CHAT_SYSTEM_PROMPT} ${INVESTIGATION_INSTRUCTION} ${AUTOMATION_BUILDING_INSTRUCTION} ${buildDateTimeContext(
    {
      timeZone,
      now,
      audience: "operator",
    },
  )}`;
}
