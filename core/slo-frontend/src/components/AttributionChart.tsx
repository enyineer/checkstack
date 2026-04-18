import React from "react";

interface AttributionChartProps {
  attribution: Array<{
    sourceType: "self" | "upstream";
    systemId?: string;
    systemName?: string;
    minutes: number;
  }>;
  totalBudgetMinutes: number;
}

/**
 * Horizontal stacked bar showing error budget consumption split by attribution.
 * Self-caused downtime in red, upstream-attributed in amber, remaining in green.
 */
export const AttributionChart: React.FC<AttributionChartProps> = ({
  attribution,
  totalBudgetMinutes,
}) => {
  if (totalBudgetMinutes <= 0) return;

  const selfMinutes = attribution
    .filter((a) => a.sourceType === "self")
    .reduce((sum, a) => sum + a.minutes, 0);

  const upstreamMinutes = attribution
    .filter((a) => a.sourceType === "upstream")
    .reduce((sum, a) => sum + a.minutes, 0);

  const selfPercent = Math.min(
    (selfMinutes / totalBudgetMinutes) * 100,
    100,
  );
  const upstreamPercent = Math.min(
    (upstreamMinutes / totalBudgetMinutes) * 100,
    100 - selfPercent,
  );
  const remainingPercent = Math.max(
    100 - selfPercent - upstreamPercent,
    0,
  );

  return (
    <div className="space-y-2">
      {/* Stacked bar */}
      <div className="h-6 rounded-full overflow-hidden flex bg-muted/30 border border-border">
        {selfPercent > 0 && (
          <div
            className="bg-destructive/80 transition-all duration-500"
            style={{ width: `${selfPercent}%` }}
            title={`Self: ${selfMinutes.toFixed(1)} min`}
          />
        )}
        {upstreamPercent > 0 && (
          <div
            className="bg-amber-500/80 transition-all duration-500"
            style={{ width: `${upstreamPercent}%` }}
            title={`Upstream: ${upstreamMinutes.toFixed(1)} min`}
          />
        )}
        {remainingPercent > 0 && (
          <div
            className="bg-emerald-500/30 transition-all duration-500"
            style={{ width: `${remainingPercent}%` }}
            title={`Remaining: ${(totalBudgetMinutes - selfMinutes - upstreamMinutes).toFixed(1)} min`}
          />
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-destructive/80" />
          <span className="text-muted-foreground">
            Self: {selfMinutes.toFixed(1)} min
          </span>
        </div>
        {upstreamMinutes > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
            <span className="text-muted-foreground">
              Upstream: {upstreamMinutes.toFixed(1)} min
            </span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/30" />
          <span className="text-muted-foreground">
            Remaining:{" "}
            {(totalBudgetMinutes - selfMinutes - upstreamMinutes).toFixed(1)}{" "}
            min
          </span>
        </div>
      </div>

      {/* Per-upstream breakdown */}
      {attribution.some((a) => a.sourceType === "upstream") && (
        <div className="text-xs text-muted-foreground space-y-0.5 pt-1">
          {attribution
            .filter((a) => a.sourceType === "upstream")
            .map((a) => (
              <div key={a.systemId ?? "unknown"} className="flex justify-between">
                <span>↳ {a.systemName ?? a.systemId ?? "Unknown"}</span>
                <span>{a.minutes.toFixed(1)} min</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
};
