import React from "react";
import { cn, usePerformance } from "@checkstack/ui";
import {
  summarizeSecrets,
  type SecretInventoryItem,
} from "./secretsDisplay.logic";

/**
 * The page's single number-led hero moment: a 3-up stat strip summarizing the
 * secrets inventory (total, set, missing value). Derived purely from the
 * already-loaded list - no new query, mutation, or test-asserted copy. The
 * "missing value" figure only takes a status hue when it is greater than zero
 * (color on signal only). No aurora here; the page header already carries it.
 */
export const SecretsInventorySummary: React.FC<{
  secrets: readonly SecretInventoryItem[];
}> = ({ secrets }) => {
  const { isLowPower } = usePerformance();
  const inventory = React.useMemo(() => summarizeSecrets(secrets), [secrets]);

  const stats: { value: number; caption: string; tinted: boolean }[] = [
    { value: inventory.total, caption: "secrets", tinted: false },
    { value: inventory.withValue, caption: "set", tinted: false },
    {
      value: inventory.missingValue,
      caption: "missing value",
      tinted: inventory.missingValue > 0,
    },
  ];

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]",
        !isLowPower && "animate-in fade-in duration-300",
      )}
    >
      <dl className="grid grid-cols-3 gap-3">
        {stats.map(({ value, caption, tinted }) => (
          <div key={caption}>
            <dd
              className={cn(
                "text-3xl font-bold leading-none tabular-nums",
                tinted ? "text-status-down" : "text-foreground",
              )}
            >
              {value}
            </dd>
            <dt className="mt-1 text-xs text-muted-foreground">{caption}</dt>
          </div>
        ))}
      </dl>
    </div>
  );
};
