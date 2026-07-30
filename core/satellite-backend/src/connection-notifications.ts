import { resolveRoute } from "@checkstack/common";
import {
  satelliteCollapseKey,
  satelliteRoutes,
} from "@checkstack/satellite-common";

/** The connection edges worth telling a subscriber about. */
export type NotifiableConnectionEvent =
  | "connected"
  | "disconnected"
  | "heartbeat_lost";

export interface SatelliteConnectionNotification {
  title: string;
  body: string;
  importance: "info" | "warning";
  collapseKey: string;
  action: { label: string; url: string };
}

/**
 * Build the notification for a satellite connection edge.
 *
 * Pure, so the wording, importance and collapse behaviour are pinned by tests
 * rather than by reading the call sites.
 *
 * ## Why losing a heartbeat is a WARNING and a clean disconnect is not
 *
 * `heartbeat_lost` means the satellite stopped answering without saying
 * goodbye - the link, the host, or the process failed. Every check that
 * satellite executes silently stops producing runs, so this is the case an
 * operator must see. A `disconnected` edge is an orderly socket close (a
 * restart, a redeploy) and is informational.
 */
export function buildSatelliteConnectionNotification({
  event,
  satelliteId,
  name,
  region,
}: {
  event: NotifiableConnectionEvent;
  satelliteId: string;
  name: string;
  region: string;
}): SatelliteConnectionNotification {
  const where = `${name} (${region})`;
  // The satellite plugin exposes only a list route today, so that is where the
  // action lands. `satelliteId` is still part of the collapse key, so the
  // notification is per-satellite even though the link is not.
  const action = {
    label: "View satellites",
    url: resolveRoute(satelliteRoutes.routes.list),
  };
  const collapseKey = satelliteCollapseKey(satelliteId);

  switch (event) {
    case "heartbeat_lost": {
      return {
        title: `Satellite offline: ${name}`,
        body:
          `Satellite **${where}** stopped sending heartbeats and is now offline.\n\n` +
          "Health checks assigned to it are not running, so the systems it probes " +
          "keep showing their last known status until it reconnects.",
        importance: "warning",
        collapseKey,
        action,
      };
    }
    case "disconnected": {
      return {
        title: `Satellite disconnected: ${name}`,
        body: `Satellite **${where}** closed its connection to the core.`,
        importance: "info",
        collapseKey,
        action,
      };
    }
    case "connected": {
      return {
        title: `Satellite online: ${name}`,
        body: `Satellite **${where}** reconnected to the core and is executing checks again.`,
        importance: "info",
        collapseKey,
        action,
      };
    }
  }
}
