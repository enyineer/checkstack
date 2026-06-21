import type { SatelliteWithStatus } from "@checkstack/satellite-common";

/**
 * At-a-glance fleet counts derived client-side from the already-loaded
 * satellite list. Pure presentation math - no query, no behavior change.
 */
export interface FleetSummary {
  total: number;
  online: number;
  offline: number;
}

/**
 * Count total / online / offline satellites from the loaded list. `online`
 * is keyed off the same `status` discriminator the badge uses, so the strip
 * never disagrees with a row.
 */
export function computeFleetSummary(
  satellites: ReadonlyArray<Pick<SatelliteWithStatus, "status">>,
): FleetSummary {
  let online = 0;
  for (const sat of satellites) {
    if (sat.status === "online") online += 1;
  }
  return {
    total: satellites.length,
    online,
    offline: satellites.length - online,
  };
}
