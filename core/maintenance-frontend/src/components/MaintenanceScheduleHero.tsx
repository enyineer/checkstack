import React from "react";
import { cn } from "@checkstack/ui";
import { format } from "date-fns";
import { formatWindowDuration, windowLengthMs } from "../utils/duration";

/**
 * Number-led schedule figure for maintenance list rows and cards: the window
 * length ("2h 30m") rendered as a tabular-nums hero with the start date as a
 * quiet caption beneath. Leads each row so the most important figure - how long
 * the system is down - reads first, demoting the absolute timestamps.
 */
export const MaintenanceScheduleHero: React.FC<{
  startAt: string | number | Date;
  endAt: string | number | Date;
  /** Visual scale of the hero figure. */
  size?: "base" | "lg";
  className?: string;
}> = ({ startAt, endAt, size = "base", className }) => {
  const duration = formatWindowDuration(windowLengthMs({ startAt, endAt }));
  return (
    <div className={cn("min-w-0", className)}>
      <p
        className={cn(
          "font-semibold leading-none tabular-nums text-foreground",
          size === "lg" ? "text-lg" : "text-base",
        )}
      >
        {duration}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {format(new Date(startAt), "MMM d, HH:mm")}
      </p>
    </div>
  );
};
