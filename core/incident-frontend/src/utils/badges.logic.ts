import type {
  IncidentStatus,
  IncidentSeverity,
  IncidentHealthOverride,
} from "@checkstack/incident-common";
import {
  pillToneStyles as toneStyles,
  type StatusPillTone as StatusTone,
} from "@checkstack/ui";

/**
 * Pure mapping from incident status/severity to the shared, colorblind-safe
 * status tones. `StatusTone` + `toneStyles` are hoisted into `@checkstack/ui`
 * (a DOM-free module) so both this plugin and maintenance consume ONE copy - the
 * type import is erased at runtime and the value import carries no React.
 *
 * Status is multi-encoded (hue + a dot + a text label, and a left accent stripe
 * on cards/rows) so it never reads by color alone.
 */
export { pillToneStyles as toneStyles } from "@checkstack/ui";
export type { StatusPillTone as StatusTone } from "@checkstack/ui";

/**
 * Impact rank for incident severity: highest impact sorts first (lowest
 * number), mirroring the severity badge/dot order. Derived from the raw enum
 * so table sorting matches urgency instead of alphabetical order.
 */
export const incidentSeverityRank: Record<IncidentSeverity, number> = {
  critical: 0,
  major: 1,
  minor: 2,
};

/**
 * Lifecycle rank for incident status: active/open stages sort before resolved,
 * following the incident lifecycle (investigating -> ... -> resolved). Derived
 * from the raw enum so ascending sort surfaces the most urgent first.
 */
export const incidentStatusRank: Record<IncidentStatus, number> = {
  investigating: 0,
  identified: 1,
  fixing: 2,
  monitoring: 3,
  resolved: 4,
};

/** Maps an incident status to its triad tone + human label. */
export function presentIncidentStatus(status: IncidentStatus): {
  tone: StatusTone;
  label: string;
} {
  switch (status) {
    case "investigating": {
      return { tone: "down", label: "Investigating" };
    }
    case "identified": {
      return { tone: "warn", label: "Identified" };
    }
    case "fixing": {
      return { tone: "warn", label: "Fixing" };
    }
    case "monitoring": {
      // Blue "info" tone: monitoring is neither a hard problem nor unknown -
      // it's an informational "watching for recurrence" state (Item 7 fix).
      return { tone: "info", label: "Monitoring" };
    }
    case "resolved": {
      return { tone: "ok", label: "Resolved" };
    }
    default: {
      return { tone: "unknown", label: status };
    }
  }
}

/** Maps an incident severity to its triad tone + human label. */
export function presentIncidentSeverity(severity: IncidentSeverity): {
  tone: StatusTone;
  label: string;
} {
  switch (severity) {
    case "critical": {
      return { tone: "down", label: "Critical" };
    }
    case "major": {
      return { tone: "warn", label: "Major" };
    }
    case "minor": {
      // Blue "info" tone: a minor incident is the lowest-impact problem, sitting
      // below major on the severity ramp. Mapping it to info gives a clean ramp
      // blue(minor) -> amber(major) -> red(critical) with no minor/major amber
      // collision (Item 7 fix).
      return { tone: "info", label: "Minor" };
    }
    default: {
      return { tone: "unknown", label: severity };
    }
  }
}

/** Maps an incident health override to its triad tone + human label. */
export function presentIncidentHealthOverride(
  healthOverride: IncidentHealthOverride,
): {
  tone: StatusTone;
  label: string;
} {
  switch (healthOverride) {
    case "unhealthy": {
      return { tone: "down", label: "Unhealthy" };
    }
    case "degraded": {
      return { tone: "warn", label: "Degraded" };
    }
    default: {
      return { tone: "unknown", label: healthOverride };
    }
  }
}

/**
 * Returns the Tailwind background class for a left accent stripe / dot tinted by
 * an incident's severity, driven by the same triad tone as the severity badge.
 * Lets cards and list rows be multi-encoded by hue + position without
 * re-deriving the severity-to-tone mapping.
 */
export function getIncidentSeverityAccentClass(
  severity: IncidentSeverity,
): string {
  return toneStyles[presentIncidentSeverity(severity).tone].accent;
}
