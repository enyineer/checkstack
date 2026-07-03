import React from "react";
import type { BaselineChips } from "./baseline.logic";

/**
 * The Expected/Trend baseline chips shown in a chart card header or above an
 * expanded metric chart. Warn-toned when the metric is drifting.
 */
export const BaselineChipStack: React.FC<{ chips: BaselineChips }> = ({
  chips,
}) => {
  if (!chips.expected && !chips.trend) return <></>;
  return (
    <div className="flex flex-col items-end gap-0.5 text-xs">
      {chips.expected && (
        <span className="font-medium text-[hsl(var(--status-warn))]">
          {chips.expected}
        </span>
      )}
      {chips.trend && (
        <span
          className={
            chips.trend.drifting
              ? "font-medium text-[hsl(var(--status-warn))]"
              : "text-muted-foreground"
          }
        >
          {chips.trend.text}
        </span>
      )}
    </div>
  );
};
