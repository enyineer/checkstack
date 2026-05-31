import type { Logger } from "@checkstack/backend-api";
import type { SignalService } from "@checkstack/signal-common";
import type { SatelliteService } from "./service";
import type { SatelliteConnectionState } from "./entity";
import {
  SATELLITE_STATUS_CHANGED,
  OFFLINE_THRESHOLD_MS,
} from "@checkstack/satellite-common";

/**
 * Optional plug-point for mirroring the heartbeat-lost (`online` → `offline`)
 * edge into the reactive `satellite-connection` entity (reactive automation
 * engine §10.6). Bound from `afterPluginsReady`; when not provided, no entity
 * state is mirrored.
 *
 * The monitor mirrors ONLY the online→offline edge (with `lastEvent:
 * "heartbeat_lost"`) — exactly the edge that previously emitted the
 * `satellite.heartbeat_lost` hook. The opposite edge (offline→online) is
 * already mirrored as `connected` by the WS handler on reconnect, so the
 * monitor leaves it alone to avoid a duplicate `connected` event.
 */
export interface SatelliteHeartbeatEntitySink {
  mirror: (
    satelliteId: string,
    state: SatelliteConnectionState,
  ) => Promise<void>;
}

/**
 * Monitors satellite heartbeats and broadcasts status change signals.
 * Tracks previous state in-memory to detect transitions (online → offline, offline → online).
 */
export class HeartbeatMonitor {
  /**
   * In-memory tracking of each satellite's last known status.
   * Used to detect transitions and avoid redundant signal broadcasts.
   */
  private previousStatuses = new Map<string, "online" | "offline">();

  constructor(
    private service: SatelliteService,
    private signalService: SignalService,
    private logger: Logger,
    private entitySink?: SatelliteHeartbeatEntitySink,
  ) {}

  /**
   * Check all satellites and broadcast status change signals for any transitions.
   * Called periodically by a recurring queue job.
   */
  async checkHeartbeats(): Promise<void> {
    const allSatellites = await this.service.listSatellites();

    for (const satellite of allSatellites) {
      const previousStatus = this.previousStatuses.get(satellite.id);
      const currentStatus = satellite.status;

      // Detect transition
      if (previousStatus !== undefined && previousStatus !== currentStatus) {
        this.logger.info(
          `Satellite ${satellite.name} (${satellite.region}) status: ${previousStatus} → ${currentStatus}`,
        );

        await this.signalService.broadcast(SATELLITE_STATUS_CHANGED, {
          satelliteId: satellite.id,
          status: currentStatus,
          name: satellite.name,
          region: satellite.region,
        });

        // Mirror the `offline` state into the reactive entity only on the
        // online → offline edge (`lastEvent: "heartbeat_lost"`). The
        // change-deriver re-fires `satellite.heartbeat_lost`. The opposite
        // transition is mirrored as `connected` by the WS handler on
        // reconnect, so the monitor leaves it alone.
        if (
          previousStatus === "online" &&
          currentStatus === "offline" &&
          this.entitySink
        ) {
          try {
            await this.entitySink.mirror(satellite.id, {
              status: "offline",
              name: satellite.name,
              region: satellite.region,
              lastSeenAt: new Date().toISOString(),
              lastEvent: "heartbeat_lost",
            });
          } catch (error) {
            this.logger.error(
              `Failed to mirror satellite-connection (heartbeat_lost) for ${satellite.name}:`,
              error,
            );
          }
        }
      }

      this.previousStatuses.set(satellite.id, currentStatus);
    }

    // Clean up tracked satellites that no longer exist
    const currentIds = new Set(allSatellites.map((s) => s.id));
    for (const trackedId of this.previousStatuses.keys()) {
      if (!currentIds.has(trackedId)) {
        this.previousStatuses.delete(trackedId);
      }
    }
  }

  /**
   * Get the offline threshold in milliseconds.
   * Exposed for testing.
   */
  static get OFFLINE_THRESHOLD_MS(): number {
    return OFFLINE_THRESHOLD_MS;
  }
}
