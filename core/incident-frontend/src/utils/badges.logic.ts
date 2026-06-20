import type {
  IncidentStatus,
  IncidentSeverity,
} from "@checkstack/incident-common";

/**
 * Pure, DOM-free mapping from incident status/severity to the colorblind-safe
 * status triad. Kept out of `badges.tsx` so the tone logic and the accent-class
 * derivation are testable without pulling React (or the incident-common runtime
 * chain) into the test process.
 *
 * Status is multi-encoded (hue + a dot + a text label, and a left accent stripe
 * on cards/rows) so it never reads by color alone.
 */
export type StatusTone = "ok" | "warn" | "down" | "unknown";

/**
 * Per-tone class sets for the status pill, its leading dot, and a left accent
 * stripe used by cards/rows. Spelled out as full literal strings (not
 * interpolated) so Tailwind's JIT keeps them, and driven by the shared status
 * triad tokens.
 */
export const toneStyles: Record<
  StatusTone,
  { pill: string; dot: string; accent: string }
> = {
  ok: {
    pill: "bg-status-ok/10 text-status-ok",
    dot: "bg-status-ok",
    accent: "bg-status-ok",
  },
  warn: {
    pill: "bg-status-warn/10 text-status-warn",
    dot: "bg-status-warn",
    accent: "bg-status-warn",
  },
  down: {
    pill: "bg-status-down/10 text-status-down",
    dot: "bg-status-down",
    accent: "bg-status-down",
  },
  unknown: {
    pill: "bg-status-unknown/10 text-status-unknown",
    dot: "bg-status-unknown",
    accent: "bg-status-unknown",
  },
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
      return { tone: "unknown", label: "Monitoring" };
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
      return { tone: "unknown", label: "Minor" };
    }
    default: {
      return { tone: "unknown", label: severity };
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
