import React from "react";
import type { HealthCheckStatus } from "@checkstack/healthcheck-common";
import { cn } from "@checkstack/ui";

interface HealthCheckSparklineProps {
  runs: Array<{
    status: HealthCheckStatus;
  }>;
  className?: string;
}

const statusColors: Record<HealthCheckStatus, string> = {
  healthy: "bg-success",
  degraded: "bg-warning",
  unhealthy: "bg-destructive",
};

/**
 * Sparkline visualization showing recent health check runs.
 * Each run is represented as a small colored rectangle.
 * Runs are displayed oldest (left) to newest (right) for consistency
 * with other time-based charts.
 */
export const HealthCheckSparkline: React.FC<HealthCheckSparklineProps> = ({
  runs,
  className,
}) => {
  // Runs come in newest-first order from API, reverse for left-to-right time display
  // Ensure we show 25 slots (with empty placeholders if fewer runs)
  const slots = Array.from(
    { length: 25 },
    (_, i) => runs[i]?.status,
  ).toReversed();

  return (
    <div className={cn("flex gap-0.5 items-center", className)}>
      {slots.map((status, index) => (
        <div
          key={index}
          className={cn(
            "w-2 h-4 rounded-sm transition-all",
            status ? statusColors[status] : "bg-muted/40",
          )}
          title={
            status ? `Run ${index + 1}: ${status}` : `Run ${index + 1}: No data`
          }
        />
      ))}
    </div>
  );
};
