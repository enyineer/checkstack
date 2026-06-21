import type { AuditSeverity } from "@checkstack/script-packages-common";

/**
 * Colorblind-safe status tones from the shared design-system triad. Maps the
 * plugin's domain status values (install state, satellite sync, advisory
 * severity) onto `ok` / `warn` / `down` / `unknown` so every status readout is
 * multi-encoded (hue + dot + label), never color-alone.
 */
export type StatusTone = "ok" | "warn" | "down" | "unknown";

/**
 * Per-tone class sets for a status pill, its leading dot, a card's left accent
 * stripe, and the foreground color for a number-led hero figure.
 */
export interface ToneStyle {
  pill: string;
  dot: string;
  accent: string;
  text: string;
}

/**
 * Full literal class strings (not interpolated) so Tailwind's JIT keeps them.
 */
export const toneStyles: Record<StatusTone, ToneStyle> = {
  ok: {
    pill: "bg-status-ok/10 text-status-ok",
    dot: "bg-status-ok",
    accent: "bg-status-ok",
    text: "text-status-ok",
  },
  warn: {
    pill: "bg-status-warn/10 text-status-warn",
    dot: "bg-status-warn",
    accent: "bg-status-warn",
    text: "text-status-warn",
  },
  down: {
    pill: "bg-status-down/10 text-status-down",
    dot: "bg-status-down",
    accent: "bg-status-down",
    text: "text-status-down",
  },
  unknown: {
    pill: "bg-status-unknown/10 text-status-unknown",
    dot: "bg-status-unknown",
    accent: "bg-status-unknown",
    text: "text-status-unknown",
  },
};

/** Install-state status values mapped to a triad tone. */
const INSTALL_STATUS_TONES: Record<string, StatusTone> = {
  ready: "ok",
  installing: "warn",
  error: "down",
  idle: "unknown",
};

/** Tone for an install-state status value (the backend's `status` string). */
export function installStatusTone(status: string | undefined): StatusTone {
  return (status && INSTALL_STATUS_TONES[status]) || "unknown";
}

/** Satellite sync status values mapped to a triad tone. */
const SATELLITE_STATUS_TONES: Record<string, StatusTone> = {
  ready: "ok",
  syncing: "warn",
  pending: "warn",
  error: "down",
};

/** Tone for a satellite sync status value. */
export function satelliteStatusTone(status: string): StatusTone {
  return SATELLITE_STATUS_TONES[status] || "unknown";
}

/** Advisory severity values mapped to a triad tone. */
const SEVERITY_TONES: Record<AuditSeverity, StatusTone> = {
  critical: "down",
  high: "down",
  moderate: "warn",
  low: "ok",
};

/** Tone for an advisory severity. */
export function severityTone(severity: AuditSeverity): StatusTone {
  return SEVERITY_TONES[severity];
}

/** Per-severity advisory counts used to derive overall audit posture. */
export interface AuditCounts {
  critical: number;
  high: number;
  moderate: number;
  low: number;
}

/**
 * Overall vulnerability-audit posture as a triad tone:
 * `ok` when there are no open advisories, `down` when any critical/high
 * advisory is present, and `warn` when only moderate/low advisories remain.
 */
export function auditPostureTone(params: {
  total: number;
  counts?: AuditCounts;
}): StatusTone {
  const { total, counts } = params;
  if (total <= 0) return "ok";
  if (counts && (counts.critical > 0 || counts.high > 0)) return "down";
  if (counts && (counts.moderate > 0 || counts.low > 0)) return "warn";
  // Advisories exist but we have no per-severity breakdown - treat as down.
  return "down";
}
