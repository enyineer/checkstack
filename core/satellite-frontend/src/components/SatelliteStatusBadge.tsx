import React from "react";
import { Badge } from "@checkstack/ui";
import type { SatelliteStatus } from "@checkstack/satellite-common";

const STATUS_CONFIG: Record<
  SatelliteStatus,
  { label: string; variant: "success" | "destructive" }
> = {
  online: { label: "Online", variant: "success" },
  offline: { label: "Offline", variant: "destructive" },
};

export const SatelliteStatusBadge: React.FC<{
  status: SatelliteStatus;
}> = ({ status }) => {
  const config = STATUS_CONFIG[status];
  return <Badge variant={config.variant}>{config.label}</Badge>;
};
