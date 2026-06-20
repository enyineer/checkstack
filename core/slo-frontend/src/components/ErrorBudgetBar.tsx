import React from "react";
import { cn, formatPercent } from "@checkstack/ui";
import {
  classifyBudgetConsumption,
  consumedBarWidthPercent,
  remainingBudgetPercent,
  type BudgetTier,
} from "./sloDisplay.logic";

interface ErrorBudgetBarProps {
  consumedPercent: number;
  warningThreshold: number;
  criticalThreshold: number;
  label?: string;
}

/**
 * The consumed portion is drawn (status-triad colored) over a faint healthy
 * band, so a fresh budget reads as a calm full-green track and consumption
 * eats into it from the left as it escalates ok -> warn -> down.
 */
const consumedFillClass: Record<BudgetTier, string> = {
  ok: "bg-status-ok",
  warning: "bg-status-warn",
  critical: "bg-status-down",
};

/**
 * Visual error budget consumption bar.
 * Shows green → amber → red progression as budget is consumed.
 */
export const ErrorBudgetBar: React.FC<ErrorBudgetBarProps> = ({
  consumedPercent,
  warningThreshold,
  criticalThreshold,
  label,
}) => {
  const remainingPercent = remainingBudgetPercent({ consumedPercent });
  const tier = classifyBudgetConsumption({
    consumedPercent,
    warningThreshold,
    criticalThreshold,
  });

  return (
    <div className="space-y-1.5">
      {label && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{label}</span>
          <span className="font-medium tabular-nums">
            {formatPercent(remainingPercent, {
              alreadyPercent: true,
              fractionDigits: 1,
            })}{" "}
            remaining
          </span>
        </div>
      )}
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-status-ok/15">
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-all duration-300",
            consumedFillClass[tier],
          )}
          style={{ width: `${consumedBarWidthPercent({ consumedPercent })}%` }}
        />
      </div>
    </div>
  );
};
