import { type StatusPillTone } from "@checkstack/ui";

/**
 * Incident lifecycle status -> colourblind-safe status tone + label for the
 * PUBLIC status page.
 *
 * Kept in lock-step with the incident status enum (`incident-common`:
 * investigating / identified / fixing / monitoring / resolved). status-page-
 * frontend is a platform-layer package and MUST NOT import the domain
 * `incident-*` packages (see `.claude/rules/dependencies.md`), so the mapping is
 * replicated here against the shared `pillToneStyles` tones - the same
 * arrangement `severityTone.ts` and `maintenanceStatusTone.ts` use.
 *
 * The lifecycle carries the hue on the DETAIL / update-timeline surfaces so a
 * reader can tell the status change apart from the message (the reported bug:
 * it was rendered in the muted grey `text-muted-foreground`). An incident's
 * SEVERITY still owns the hue on the block CARD (one coloured dimension per
 * row); these tones are for the status label itself where it is the subject.
 *
 * - amber (`warn`) while the team is actively working the incident
 *   (investigating / identified / fixing),
 * - blue (`info`) once it is monitoring for recovery,
 * - green (`ok`) when resolved.
 */
const INCIDENT_STATUS_TONE: Record<string, StatusPillTone> = {
  investigating: "warn",
  identified: "warn",
  fixing: "warn",
  monitoring: "info",
  resolved: "ok",
};

const INCIDENT_STATUS_LABEL: Record<string, string> = {
  investigating: "Investigating",
  identified: "Identified",
  fixing: "Fixing",
  monitoring: "Monitoring",
  resolved: "Resolved",
};

/** Resolve an incident status to its tone, defaulting to the neutral grey. */
export function incidentStatusTone(status: string): StatusPillTone {
  return INCIDENT_STATUS_TONE[status] ?? "unknown";
}

/** Human label for an incident status, falling back to the raw value. */
export function incidentStatusLabel(status: string): string {
  return INCIDENT_STATUS_LABEL[status] ?? status;
}
