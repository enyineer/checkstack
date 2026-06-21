import React, { useEffect, useState } from "react";
import type { MaintenanceStatus } from "@checkstack/maintenance-common";
import { formatWindowDuration, windowLengthMs } from "../utils/duration";

/**
 * Derive the hero figure + caption for the detail card from the window bounds
 * and status. Pure so the branch logic (live remaining vs static length) is
 * testable without a clock. `now` is injected for the live in_progress case.
 */
export function deriveWindowHero({
  startAt,
  endAt,
  status,
  now,
}: {
  startAt: string | number | Date;
  endAt: string | number | Date;
  status: MaintenanceStatus;
  now: number;
}): { figure: string; caption: string } {
  if (status === "in_progress") {
    const remaining = Math.max(0, new Date(endAt).getTime() - now);
    return {
      figure: formatWindowDuration(remaining),
      caption: "time remaining",
    };
  }
  return {
    figure: formatWindowDuration(windowLengthMs({ startAt, endAt })),
    caption: "window length",
  };
}

/**
 * The single number-led hero on the maintenance detail card: a large
 * tabular-nums figure showing the window length, or a live "time remaining"
 * countdown while the window is in progress. Ticks once a minute - the figure
 * is minute-resolution, so a faster interval would only burn cycles.
 */
export const MaintenanceWindowHero: React.FC<{
  startAt: string | number | Date;
  endAt: string | number | Date;
  status: MaintenanceStatus;
}> = ({ startAt, endAt, status }) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (status !== "in_progress") return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [status]);

  const { figure, caption } = deriveWindowHero({ startAt, endAt, status, now });

  return (
    <div>
      <p className="text-3xl font-bold leading-none tabular-nums text-foreground">
        {figure}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
    </div>
  );
};
