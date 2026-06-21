import React from "react";
import { cn } from "@checkstack/ui";
import type { SatelliteWithStatus } from "@checkstack/satellite-common";
import { computeFleetSummary } from "./fleetSummary.logic";

const TILE_SHELL =
  "relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]";

interface StatTileProps {
  value: number;
  caption: string;
  /** Hero number tint. */
  numberClassName?: string;
  /** Left accent stripe colour, when this tile encodes a status. */
  accentClassName?: string;
  /** Status dot colour beside the caption, when this tile encodes a status. */
  dotClassName?: string;
}

const StatTile: React.FC<StatTileProps> = ({
  value,
  caption,
  numberClassName,
  accentClassName,
  dotClassName,
}) => (
  <div className={TILE_SHELL}>
    {accentClassName && (
      <span
        className={cn("absolute inset-y-0 left-0 w-1", accentClassName)}
        aria-hidden
      />
    )}
    <div className={accentClassName ? "pl-2" : undefined}>
      <p
        className={cn(
          "text-3xl font-bold leading-none tabular-nums",
          numberClassName ?? "text-foreground",
        )}
      >
        {value}
      </p>
      <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        {dotClassName && (
          <span
            className={cn("size-1.5 rounded-full", dotClassName)}
            aria-hidden
          />
        )}
        {caption}
      </p>
    </div>
  </div>
);

/**
 * The page's single hero moment: a number-led read of fleet health derived
 * client-side from the loaded list. Online/offline lead with their counts and
 * carry a left accent stripe + dot so status is multi-encoded (position + hue),
 * never colour alone. Offline mutes to neutral when the fleet is fully healthy.
 */
export const FleetSummaryStrip: React.FC<{
  satellites: ReadonlyArray<Pick<SatelliteWithStatus, "status">>;
}> = ({ satellites }) => {
  const { total, online, offline } = computeFleetSummary(satellites);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <StatTile value={total} caption="satellites" />
      <StatTile
        value={online}
        caption="online"
        numberClassName="text-status-ok"
        accentClassName="bg-status-ok"
        dotClassName="bg-status-ok"
      />
      <StatTile
        value={offline}
        caption="offline"
        numberClassName={offline > 0 ? "text-status-down" : "text-muted-foreground"}
        accentClassName={offline > 0 ? "bg-status-down" : "bg-border"}
        dotClassName={offline > 0 ? "bg-status-down" : "bg-muted-foreground"}
      />
    </div>
  );
};
