import React from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

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
  if (burnRate === null || burnRate === undefined) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <Minus className="w-3.5 h-3.5" />
        <span>N/A</span>
      </span>
    );
  }

  const isGood = burnRate < 1;
  const isBad = burnRate > 1.5;

  return (
    <span
      className={`inline-flex items-center gap-1 text-sm font-medium ${
        isGood
          ? "text-success"
          : isBad
            ? "text-destructive"
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
      <span>{burnRate.toFixed(2)}x</span>
    </span>
  );
};
