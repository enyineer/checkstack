import React from "react";
import { cn, usePerformance } from "@checkstack/ui";
import type { Announcement } from "@checkstack/announcement-common";
import {
  STATUS_BUCKETS,
  statusToTone,
  tallyStatuses,
} from "./announcementStatus.logic";
import { toneStyles } from "./StatusPill";

/**
 * A 4-up number-led stat strip summarizing the announcement list by lifecycle
 * status. Derived purely from the already-loaded array - no new data or query.
 */
export const AnnouncementStatSummary: React.FC<{
  announcements: readonly Announcement[];
}> = ({ announcements }) => {
  const { isLowPower } = usePerformance();
  const counts = React.useMemo(
    () => tallyStatuses(announcements),
    [announcements],
  );

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {STATUS_BUCKETS.map(({ status, label }) => {
        const accent = toneStyles[statusToTone(status)].accent;
        return (
          <div
            key={status}
            className={cn(
              "relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]",
              !isLowPower && "animate-in fade-in duration-300",
            )}
          >
            <span
              className={cn("absolute inset-y-0 left-0 w-1", accent)}
              aria-hidden
            />
            <div className="pl-2">
              <p className="text-3xl font-bold leading-none tabular-nums text-foreground">
                {counts[status]}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{label}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
};
