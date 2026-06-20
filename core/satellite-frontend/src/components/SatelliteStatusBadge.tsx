import React from "react";
import { cn } from "@checkstack/ui";
import type { SatelliteStatus } from "@checkstack/satellite-common";

type SatelliteStatusTone = "ok" | "down";

/**
 * Per-tone pill + dot classes. Spelled out as full literal strings (not
 * interpolated) so Tailwind's JIT keeps them, driven by the colorblind-safe
 * status triad. Status reads as hue + dot + text label, never color alone.
 */
const STATUS_CONFIG: Record<
  SatelliteStatus,
  { label: string; tone: SatelliteStatusTone }
> = {
  online: { label: "Online", tone: "ok" },
  offline: { label: "Offline", tone: "down" },
};

const TONE_STYLES: Record<
  SatelliteStatusTone,
  { pill: string; dot: string }
> = {
  ok: { pill: "bg-status-ok/10 text-status-ok", dot: "bg-status-ok" },
  down: { pill: "bg-status-down/10 text-status-down", dot: "bg-status-down" },
};

export const SatelliteStatusBadge: React.FC<{
  status: SatelliteStatus;
}> = ({ status }) => {
  const config = STATUS_CONFIG[status];
  const styles = TONE_STYLES[config.tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        styles.pill,
      )}
    >
      <span className={cn("size-1.5 rounded-full", styles.dot)} aria-hidden />
      {config.label}
    </span>
  );
};
