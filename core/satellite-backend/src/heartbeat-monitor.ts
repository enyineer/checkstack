import type { Logger } from "@checkstack/backend-api";
import type { SignalService } from "@checkstack/signal-common";
import type { SatelliteService } from "./service";
import {
  SATELLITE_STATUS_CHANGED,
  OFFLINE_THRESHOLD_MS,
} from "@checkstack/satellite-common";

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
