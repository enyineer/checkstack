import React from "react";
import {
  StatusPill,
  pillToneStyles as toneStyles,
  type StatusPillTone as StatusTone,
} from "@checkstack/ui";
import type { MaintenanceStatus } from "@checkstack/maintenance-common";

// `StatusTone` + `toneStyles` are hoisted into `@checkstack/ui` so incidents and
// maintenance share ONE colorblind-safe tone set (including the new blue `info`
// hue). Re-exported for existing local consumers.
export type { StatusPillTone as StatusTone } from "@checkstack/ui";

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
export function presentMaintenanceStatus(status: MaintenanceStatus): {
  tone: StatusTone;
  label: string;
} {
  switch (status) {
    case "in_progress": {
      return { tone: "warn", label: "In Progress" };
    }
    case "scheduled": {
      // Blue "info" tone: an upcoming planned window is informational, not an
      // unknown/inert state - grey was misleading (Item 7 fix).
      return { tone: "info", label: "Scheduled" };
    }
    case "completed": {
      return { tone: "ok", label: "Completed" };
    }
    case "cancelled": {
      // Grey "unknown" is correct here: a cancelled window is a voided no-op,
      // genuinely inert - it carries no good/bad/informational signal.
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
  return <StatusPill tone={tone}>{label}</StatusPill>;
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
