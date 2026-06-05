import React from "react";
import type { SystemSignalTone } from "@checkstack/catalog-common";
import { DynamicIcon, cn, type IconName } from "@checkstack/ui";
import type { SeverityCounts } from "../logic/systemSignals";

interface ToneChip {
  tone: SystemSignalTone;
  label: string;
  icon: IconName;
  count: number;
  activeClass: string;
}

const idleClass =
  "border-border bg-card text-muted-foreground hover:bg-muted/50";

/**
 * Compact fleet-health strip: a one-line summary plus severity chips that
 * double as filters for the problem list. Counts come straight from the
 * aggregated signals so the strip is agnostic to which plugins produced them.
 */
export const FleetHealthHeader: React.FC<{
  systemsCount: number;
  problemsCount: number;
  counts: SeverityCounts;
  healthyCount: number;
  activeTone: SystemSignalTone | null;
  onToneSelect: (tone: SystemSignalTone | null) => void;
  isLowPower: boolean;
}> = ({
  systemsCount,
  problemsCount,
  counts,
  healthyCount,
  activeTone,
  onToneSelect,
  isLowPower,
}) => {
  const chips: ToneChip[] = [
    {
      tone: "error",
      label: "Critical",
      icon: "OctagonAlert",
      count: counts.error,
      activeClass: "border-destructive bg-destructive/10 text-destructive",
    },
    {
      tone: "warn",
      label: "Degraded",
      icon: "TriangleAlert",
      count: counts.warn,
      activeClass: "border-warning bg-warning/10 text-warning",
    },
    {
      tone: "info",
      label: "Watch",
      icon: "Info",
      count: counts.info,
      activeClass: "border-info bg-info/10 text-info",
    },
  ];

  const summary =
    problemsCount === 0
      ? "All systems healthy"
      : `${problemsCount} of ${systemsCount} ${problemsCount === 1 ? "system needs" : "systems need"} attention`;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm font-medium text-foreground">{summary}</p>
      <div className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => {
          const active = activeTone === chip.tone;
          return (
            <button
              key={chip.tone}
              type="button"
              aria-pressed={active}
              onClick={() => onToneSelect(active ? null : chip.tone)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                !isLowPower && "transition-colors",
                active ? chip.activeClass : idleClass,
              )}
            >
              <DynamicIcon name={chip.icon} className="h-3.5 w-3.5" />
              <span className="tabular-nums">{chip.count}</span>
              {chip.label}
            </button>
          );
        })}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
          <DynamicIcon name="ShieldCheck" className="h-3.5 w-3.5 text-success" />
          <span className="tabular-nums">{healthyCount}</span>
          Healthy
        </span>
      </div>
    </div>
  );
};
