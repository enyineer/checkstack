import React from "react";
import { cn, pillToneStyles, StatusPill } from "@checkstack/ui";
import type { RunStatus } from "@checkstack/automation-common";

/**
 * Colorblind-safe status tone for a run. Only the terminal health outcomes map
 * to the status triad; in-flight and neutral lifecycle states (`pending`,
 * `running`, `cancelled`, `skipped`) read as `unknown` so color is never the
 * sole carrier of a "good vs bad" signal.
 */
export type RunStatusTone = "ok" | "warn" | "down" | "unknown";

export const RUN_STATUS_TONE: Record<RunStatus, RunStatusTone> = {
  pending: "unknown",
  running: "unknown",
  waiting: "warn",
  success: "ok",
  failed: "down",
  cancelled: "unknown",
  skipped: "unknown",
};

/**
 * Per-tone pill + dot + left-accent classes, taken from the shared
 * `pillToneStyles` table rather than a private copy. The `accent` class drives
 * the left status stripe on cards and timeline rows so the stripe always
 * matches the pill.
 */
export const RUN_TONE_STYLES: Pick<typeof pillToneStyles, RunStatusTone> = {
  ok: pillToneStyles.ok,
  warn: pillToneStyles.warn,
  down: pillToneStyles.down,
  unknown: pillToneStyles.unknown,
};

/**
 * Multi-encoded run-status pill: a tinted chip carrying a status dot plus the
 * run status word. The visible label keeps the raw `run.status` value so it
 * matches the status filter buttons one-to-one.
 */
export const RunStatusPill: React.FC<{
  status: RunStatus;
  className?: string;
}> = ({ status, className }) => (
  <StatusPill
    tone={RUN_STATUS_TONE[status]}
    className={cn("capitalize", className)}
  >
    {status}
  </StatusPill>
);
