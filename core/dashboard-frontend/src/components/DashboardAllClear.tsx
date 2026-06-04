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
        "overflow-hidden border-success/30",
        isLowPower
          ? "bg-success/5"
          : "bg-gradient-to-br from-success/10 via-transparent to-transparent",
      )}
    >
      <CardContent className="flex flex-col items-center py-14 text-center">
        <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-success/10 text-success">
          <DynamicIcon name="ShieldCheck" className="h-7 w-7" />
        </div>
        <p className="text-lg font-semibold text-foreground">All clear</p>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          All <AnimatedCounter value={systemsCount} /> systems are healthy.
          Nothing needs your attention right now.
        </p>
      </CardContent>
    </Card>
  );
};
