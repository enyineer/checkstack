import React, { useMemo } from "react";
import type { HealthCheckStatus } from "@checkstack/healthcheck-common";
import { UptimeRibbon, cn, type RibbonCell, type RibbonStatus } from "@checkstack/ui";

interface HealthCheckSparklineProps {
  runs: Array<{
    status: HealthCheckStatus;
  }>;
  className?: string;
}

const SLOT_COUNT = 25;

const statusToRibbon: Record<HealthCheckStatus, RibbonStatus> = {
  healthy: "ok",
  degraded: "warn",
  unhealthy: "down",
};

const statusLabel: Record<HealthCheckStatus, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  unhealthy: "Unhealthy",
};

/**
 * Per-run status track for a list row: a row of green / amber / red segments,
 * oldest (left) to newest (right). Reskinned onto the design-system
 * {@link UptimeRibbon} primitive (`reviews/design/expressive` uptime ribbon +
 * `reviews/design/calm-premium` per-system track) so the all-good state reads
 * serene and the status is multi-encoded (hue + per-cell title + the ribbon's
 * accessible uptime summary), never color alone.
 *
 * Runs come in chronological order from the API (oldest first). Missing slots
 * render as `unknown` cells so the footprint stays fixed (no layout shift).
 */
export const HealthCheckSparkline: React.FC<HealthCheckSparklineProps> = ({
  runs,
  className,
}) => {
  const cells = useMemo<RibbonCell[]>(
    () =>
      Array.from({ length: SLOT_COUNT }, (_, i): RibbonCell => {
        const status = runs[i]?.status;
        return status
          ? {
              id: `run-${i}`,
              status: statusToRibbon[status],
              label: statusLabel[status],
            }
          : { id: `empty-${i}`, status: "unknown", label: "No data" };
      }),
    [runs],
  );

  return (
    <UptimeRibbon
      cells={cells}
      height={16}
      gap={2}
      className={cn("w-[88px]", className)}
    />
  );
};
