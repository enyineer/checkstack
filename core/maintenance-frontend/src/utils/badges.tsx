import React from "react";
import { cn } from "@checkstack/ui";
import type { MaintenanceStatus } from "@checkstack/maintenance-common";

/**
 * Colorblind-safe status triad tones. Status is multi-encoded (hue + a dot +
 * a text label) so it never reads by color alone.
 */
export type StatusTone = "ok" | "warn" | "down" | "unknown";

/**
 * Per-tone class sets for the status pill, its leading dot, and the left
 * accent stripe used on premium cards/rows. Spelled out as full literal
 * strings (not interpolated) so Tailwind's JIT keeps them, and driven by the
 * shared status triad tokens.
 */
const toneStyles: Record<
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

/**
 * A compact, multi-encoded status pill: a tinted chip carrying a small status
 * dot and a text label, so the signal reads by hue, position, and words - never
 * color alone. Used for maintenance status throughout the plugin.
 */
const StatusPill: React.FC<{ tone: StatusTone; label: string }> = ({
  tone,
  label,
}) => {
  const styles = toneStyles[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        styles.pill
      )}
    >
      <span className={cn("size-1.5 rounded-full", styles.dot)} aria-hidden />
      {label}
    </span>
  );
};

/**
 * Impact rank for maintenance status: active windows sort first, then upcoming,
 * then finished. Derived from the raw enum so ascending table sort surfaces the
 * live/soon windows before completed or cancelled ones.
 */
export const maintenanceStatusRank: Record<MaintenanceStatus, number> = {
  in_progress: 0,
  scheduled: 1,
  completed: 2,
  cancelled: 3,
};

/** Maps a maintenance status to its triad tone + human label. */
function presentMaintenanceStatus(status: MaintenanceStatus): {
  tone: StatusTone;
  label: string;
} {
  switch (status) {
    case "in_progress": {
      return { tone: "warn", label: "In Progress" };
    }
    case "scheduled": {
      return { tone: "unknown", label: "Scheduled" };
    }
    case "completed": {
      return { tone: "ok", label: "Completed" };
    }
    case "cancelled": {
      return { tone: "unknown", label: "Cancelled" };
    }
    default: {
      return { tone: "unknown", label: status };
    }
  }
}

/**
 * Returns a styled status pill for the given maintenance status.
 * Use this utility to ensure consistent status badge styling across the plugin.
 */
export function getMaintenanceStatusBadge(
  status: MaintenanceStatus
): React.ReactNode {
  const { tone, label } = presentMaintenanceStatus(status);
  return <StatusPill tone={tone} label={label} />;
}

/**
 * Maps a maintenance status to its colorblind-safe triad tone. Surfaced so
 * premium list rows / cards can paint a left accent stripe in the same hue the
 * pill already uses - status presentation logic stays in one place.
 */
export function getMaintenanceStatusTone(status: MaintenanceStatus): StatusTone {
  return presentMaintenanceStatus(status).tone;
}

/** Returns the Tailwind background class for a tone's left accent stripe. */
export function getMaintenanceToneAccentClass(tone: StatusTone): string {
  return toneStyles[tone].accent;
}
