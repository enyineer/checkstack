import { type StatusPillTone } from "@checkstack/ui";

/**
 * Maintenance status -> colorblind-safe status tone + label for the PUBLIC
 * status page.
 *
 * Kept in lock-step with the canonical mapping in
 * `core/maintenance-frontend/src/utils/badges.tsx` (`presentMaintenanceStatus`):
 * `in_progress` -> warn (amber), `scheduled` -> info (blue), `completed` -> ok
 * (green), `cancelled` -> unknown (grey).
 *
 * status-page-frontend is a platform-layer package and MUST NOT import the
 * domain `maintenance-*` packages (see `.claude/rules/dependencies.md`), so the
 * mapping is replicated here against the shared `pillToneStyles` tones from
 * `@checkstack/ui` rather than imported - the same arrangement `severityTone.ts`
 * uses for incident severity.
 *
 * Every public maintenance surface used to hardcode the grey `unknown` tone for
 * ALL statuses, so a window that was definitely planned and definitely coming
 * read as inert, and disagreed with the blue it was given everywhere else.
 * Maintenance carries no severity, so its lifecycle is the one dimension that
 * gets the hue (see the "at most one coloured dimension per row" rule on
 * `status-tone.ts`).
 */
const MAINTENANCE_STATUS_TONE: Record<string, StatusPillTone> = {
  in_progress: "warn",
  scheduled: "info",
  completed: "ok",
  cancelled: "unknown",
};

/**
 * Human labels for the raw enum. The public surfaces previously rendered
 * `status.replace("_", " ")` under a `capitalize` class, which yields
 * "In progress" rather than the "In Progress" every other surface shows.
 */
const MAINTENANCE_STATUS_LABEL: Record<string, string> = {
  in_progress: "In Progress",
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** Resolves a maintenance status to its tone, defaulting to `unknown`. */
export function maintenanceStatusTone(status: string): StatusPillTone {
  return MAINTENANCE_STATUS_TONE[status] ?? "unknown";
}

/**
 * Resolves a maintenance status to its display label. Falls back to the raw
 * value so an unrecognised status still reads as something rather than blank.
 */
export function maintenanceStatusLabel(status: string): string {
  return MAINTENANCE_STATUS_LABEL[status] ?? status.replace("_", " ");
}
