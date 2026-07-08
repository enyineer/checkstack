import { pillToneStyles, type StatusPillTone } from "@checkstack/ui";

/**
 * Incident severity -> colorblind-safe status tone for the PUBLIC status page.
 *
 * Kept in lock-step with the canonical incident mapping in
 * `core/incident-frontend/src/utils/badges.logic.ts` (`presentIncidentSeverity`):
 * `critical` -> down (red), `major` -> warn (amber), `minor` -> info (blue).
 * A `minor` incident used to fall through to the neutral grey `unknown` tone,
 * which read as "inert/unknown" rather than "lowest-impact problem".
 *
 * status-page-frontend is a platform-layer package and MUST NOT import the
 * domain `incident-*` packages (see `.claude/rules/dependencies.md`), so the
 * mapping is replicated here against the shared `pillToneStyles` tones from
 * `@checkstack/ui` rather than imported from `incident-frontend`.
 */
const SEVERITY_TONE: Record<string, StatusPillTone> = {
  critical: "down",
  major: "warn",
  minor: "info",
};

/** Resolves a severity string to its status tone, defaulting to `unknown`. */
export function severityTone(severity: string): StatusPillTone {
  return SEVERITY_TONE[severity] ?? "unknown";
}

/** Soft pill classes (bg tint + text) for an incident severity badge. */
export function severityPillClass(severity: string): string {
  return pillToneStyles[severityTone(severity)].pill;
}

/** Solid accent-stripe hue for an incident severity. */
export function severityStripeClass(severity: string): string {
  return pillToneStyles[severityTone(severity)].accent;
}
