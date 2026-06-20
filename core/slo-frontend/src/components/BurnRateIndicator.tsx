import React from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { classifyBurnRate } from "./sloDisplay.logic";

interface BurnRateIndicatorProps {
  burnRate: number | null;
}

/**
 * Visual burn rate indicator.
 * Shows how fast the error budget is being consumed relative to the window.
 * - < 1.0: consuming slower than expected (good)
 * - 1.0: on pace
 * - > 1.0: consuming faster than expected (bad)
 */
export const BurnRateIndicator: React.FC<BurnRateIndicatorProps> = ({
  burnRate,
}) => {
  const tier = classifyBurnRate({ burnRate });

  if (tier === "unknown") {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <Minus className="w-3.5 h-3.5" />
        <span>N/A</span>
      </span>
    );
  }

  const isGood = tier === "good";
  const isBad = tier === "bad";

  return (
    <span
      className={`inline-flex items-center gap-1 text-sm font-medium ${
        isGood
          ? "text-status-ok"
          : isBad
            ? "text-status-down"
            : "text-muted-foreground"
      }`}
    >
      {isGood ? (
        <TrendingDown className="w-3.5 h-3.5" />
      ) : isBad ? (
        <TrendingUp className="w-3.5 h-3.5" />
      ) : (
        <Minus className="w-3.5 h-3.5" />
      )}
      <span>{(burnRate ?? 0).toFixed(2)}x</span>
    </span>
  );
};
