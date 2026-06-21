import React from "react";
import {
  Card,
  CardContent,
  DynamicIcon,
  AnimatedCounter,
  cn,
} from "@checkstack/ui";

/**
 * The dashboard's resting state: a calm, reassuring "all clear" hero shown when
 * every monitored system is healthy. A soft success glow is used only when the
 * device can afford it; low-power devices get a solid tint instead.
 */
export const DashboardAllClear: React.FC<{
  systemsCount: number;
  isLowPower: boolean;
}> = ({ systemsCount, isLowPower }) => {
  return (
    <Card
      className={cn(
        "relative overflow-hidden rounded-[var(--d-card-r)] border border-status-ok/30 bg-gradient-to-b from-surface-2 to-surface",
        !isLowPower &&
          "shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]",
      )}
    >
      {/* Success accent: a soft wash on capable devices, a solid tint otherwise. */}
      <div
        className={cn(
          "pointer-events-none absolute inset-0",
          isLowPower
            ? "bg-status-ok/5"
            : "bg-gradient-to-br from-status-ok/10 via-transparent to-transparent",
        )}
        aria-hidden="true"
      />
      <CardContent className="relative flex flex-col items-center py-14 text-center">
        <div className="mb-5 flex size-14 items-center justify-center rounded-full bg-status-ok/10 text-status-ok">
          <DynamicIcon name="ShieldCheck" className="h-7 w-7" />
        </div>
        {/* Number-led hero: how many systems are healthy is the dominant figure. */}
        <p className="text-3xl font-bold leading-none tabular-nums text-status-ok">
          <AnimatedCounter value={systemsCount} />
        </p>
        <p className="mt-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          systems healthy
        </p>
        <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-status-ok/10 px-2.5 py-1 text-xs font-medium text-status-ok">
          <span
            className="size-1.5 rounded-full bg-status-ok"
            aria-hidden="true"
          />
          All clear
        </span>
        <p className="mt-3 max-w-prose text-xs text-muted-foreground">
          All <AnimatedCounter value={systemsCount} /> systems are healthy.
          Nothing needs your attention right now.
        </p>
      </CardContent>
    </Card>
  );
};
