import React from "react";

interface ErrorBudgetBarProps {
  consumedPercent: number;
  warningThreshold: number;
  criticalThreshold: number;
  label?: string;
}

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
  const remainingPercent = Math.max(0, 100 - consumedPercent);
  const getBarColor = () => {
    if (consumedPercent >= criticalThreshold) return "var(--destructive)";
    if (consumedPercent >= warningThreshold) return "var(--warning)";
    return "var(--success)";
  };

  return (
    <div className="space-y-1.5">
      {label && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{label}</span>
          <span className="font-medium tabular-nums">
            {remainingPercent.toFixed(1)}% remaining
          </span>
        </div>
      )}
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${Math.min(consumedPercent, 100)}%`,
            backgroundColor: getBarColor(),
          }}
        />
      </div>
    </div>
  );
};
