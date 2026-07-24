import React from "react";
import { StatusPill, type StatusPillTone } from "@checkstack/ui";
import type { SatelliteStatus } from "@checkstack/satellite-common";

/**
 * A satellite's connection state on the colorblind-safe status triad. The
 * chrome comes from the shared `StatusPill`, so only the domain mapping (which
 * state means which tone, and what it is called) lives here.
 */
const STATUS_CONFIG: Record<
  SatelliteStatus,
  { label: string; tone: StatusPillTone }
> = {
  online: { label: "Online", tone: "ok" },
  offline: { label: "Offline", tone: "down" },
};

export const SatelliteStatusBadge: React.FC<{
  status: SatelliteStatus;
}> = ({ status }) => {
  const { label, tone } = STATUS_CONFIG[status];
  return <StatusPill tone={tone}>{label}</StatusPill>;
};
