import React from "react";
import { cn } from "@checkstack/ui";
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
 * Per-tone pill + dot + left-accent classes. Spelled out as full literal
 * strings (not interpolated) so Tailwind's JIT keeps them, driven by the
 * colorblind-safe status triad. Status reads as hue + dot + text label, never
 * color alone. The `accent` class drives the left status stripe on cards and
 * timeline rows so the stripe always matches this pill.
 */
export const RUN_TONE_STYLES: Record<
  RunStatusTone,
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

/**
 * Multi-encoded run-status pill: a tinted chip carrying a status dot plus the
 * run status word. The visible label keeps the raw `run.status` value so it
 * matches the status filter buttons one-to-one.
 */
export const RunStatusPill: React.FC<{
  status: RunStatus;
  className?: string;
}> = ({ status, className }) => {
  const styles = RUN_TONE_STYLES[RUN_STATUS_TONE[status]];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium capitalize",
        styles.pill,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", styles.dot)} aria-hidden />
      {status}
    </span>
  );
};
