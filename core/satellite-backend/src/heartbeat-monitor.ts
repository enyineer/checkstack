import type { Logger } from "@checkstack/backend-api";
import type { SignalService } from "@checkstack/signal-common";
import type { SatelliteService } from "./service";
import type { SatelliteConnectionEvent } from "./entity";
import { computeStatus } from "./status";
import { SATELLITE_STATUS_CHANGED } from "@checkstack/satellite-common";

/**
 * Plug-point for driving the heartbeat-lost (`online` → `offline`) edge into
 * the reactive `satellite-connection` entity (reactive automation engine
 * §10.6). Bound from `afterPluginsReady`; when not provided, no entity state is
 * mirrored.
 *
 * The monitor flips ONLY `lastConnectionEvent` to `"heartbeat_lost"` (leaving
 * the already-aged `lastHeartbeatAt` untouched, since it is what made the
 * computed status `offline` in the first place). The change-deriver re-fires
 * `satellite.heartbeat_lost`. The opposite edge (offline→online) is mirrored as
 * `connected` by the WS handler on reconnect, so the monitor leaves it alone.
 */
export interface SatelliteHeartbeatEntitySink {
  mirror: (satelliteId: string) => Promise<void>;
}

/**
 * Notifies subscribers that a satellite lost its heartbeat.
 *
 * Called from the same guarded branch as the entity mirror, so it inherits the
 * monitor's idempotency: the durable `lastConnectionEvent` flip means the
 * branch is entered exactly once per offline edge, cluster-wide, no matter how
 * many pods run the check.
 */
export interface SatelliteOfflineNotifier {
  notifyOffline: (props: {
    satelliteId: string;
    name: string;
    region: string;
  }) => Promise<void>;
}

/**
 * Monitors satellite heartbeats and detects the online→offline transition from
 * DURABLE state alone — no pod-local baseline.
 *
 * ## Horizontal-scale correctness
 *
 * The heartbeat-check job runs under ONE consumer group claimed by a VARYING
 * pod. A process-local "previous status" map is therefore wrong: a pod with an
 * empty map never sees the online→offline edge, so `connectionStatus` could get
 * stuck `online` forever after a pod crash. This monitor instead reads every
 * satellite's durable `(lastHeartbeatAt, lastConnectionEvent)`, computes status
 * via {@link computeStatus} (the same wall-clock liveness rule the entity read
 * uses), and detects the heartbeat-lost edge purely from durable state:
 *
 *   computed status is `offline` AND `lastConnectionEvent === "connected"`
 *     ⇒ this satellite just lost its heartbeat (it was last marked connected,
 *       but its heartbeat has now aged past the offline threshold).
 *
 * The mutate that flips `lastConnectionEvent` to `"heartbeat_lost"` is
 * IDEMPOTENT across pods and redelivery: once it is `"heartbeat_lost"`, the
 * predicate above is false, so re-runs (on any pod) are no-ops, and the entity
 * handle's diff-on-unchanged suppresses any duplicate transition/event. Any pod
 * can therefore drive the edge correctly, regardless of which pod (if any) ever
 * observed the satellite online in memory.
 */
export class HeartbeatMonitor {
  /**
   * Pod-local broadcast-dedup ONLY (never the source of truth). The durable
   * `lastConnectionEvent` flip is what makes detection idempotent; this set
   * merely avoids re-broadcasting the same status-change signal from this pod on
   * back-to-back checks. A fresh pod with an empty set still detects + mirrors
   * the edge from durable state — it just also broadcasts once, which is benign.
   */
  private broadcastedOffline = new Set<string>();

  constructor(
    private service: SatelliteService,
    private signalService: SignalService,
    private logger: Logger,
    private entitySink?: SatelliteHeartbeatEntitySink,
    private notifier?: SatelliteOfflineNotifier,
  ) {}

  /**
   * Check all satellites and drive the heartbeat-lost edge for any that have
   * aged out while still marked connected. Called periodically by a recurring
   * queue job; safe to run on any pod and to redeliver.
   */
  async checkHeartbeats(): Promise<void> {
    const rows = await this.service.listConnectionLiveness();
    const liveIds = new Set(rows.map((r) => r.id));

    for (const row of rows) {
      const status = computeStatus({
        lastHeartbeatAt: row.lastHeartbeatAt,
        offlineThresholdMs: row.offlineThresholdMs,
      });
      const lostHeartbeat = this.hasLostHeartbeat({
        status,
        lastConnectionEvent: row.lastConnectionEvent,
      });

      if (!lostHeartbeat) {
        // Still online (or already past the lost edge / never connected):
        // nothing to detect. Clear the broadcast-dedup marker once a satellite
        // is no longer in the lost state so a future lost edge re-broadcasts.
        if (status === "online") this.broadcastedOffline.delete(row.id);
        continue;
      }

      // Durable heartbeat-lost edge: computed offline while still marked
      // `connected`. Detected from durable state, so this fires correctly from
      // ANY pod with no prior in-memory knowledge of the satellite.
      this.logger.info(
        `Satellite ${row.name} (${row.region}) lost heartbeat (online → offline)`,
      );

      // Broadcast the status-change signal once per offline edge from this pod.
      if (!this.broadcastedOffline.has(row.id)) {
        this.broadcastedOffline.add(row.id);
        await this.signalService.broadcast(SATELLITE_STATUS_CHANGED, {
          satelliteId: row.id,
          status: "offline",
          name: row.name,
          region: row.region,
        });
      }

      // Tell subscribers BEFORE mirroring: the mirror is what makes this branch
      // unreachable again, so notifying after it would be lost if the mirror
      // succeeded and the process died before the notification went out.
      // Notification failure must never block the entity edge, hence the catch.
      if (this.notifier) {
        try {
          await this.notifier.notifyOffline({
            satelliteId: row.id,
            name: row.name,
            region: row.region,
          });
        } catch (error) {
          this.logger.error(
            `Failed to notify subscribers that satellite ${row.name} went offline:`,
            error,
          );
        }
      }

      // Drive the entity edge. The mutate is idempotent: it flips
      // `lastConnectionEvent` to `"heartbeat_lost"`, after which this branch is
      // never re-entered for the same satellite (re-runs are no-ops).
      if (this.entitySink) {
        try {
          await this.entitySink.mirror(row.id);
        } catch (error) {
          this.logger.error(
            `Failed to mirror satellite-connection (heartbeat_lost) for ${row.name}:`,
            error,
          );
        }
      }
    }

    // Drop broadcast-dedup markers for satellites that no longer exist.
    for (const id of this.broadcastedOffline) {
      if (!liveIds.has(id)) this.broadcastedOffline.delete(id);
    }
  }

  /**
   * Pure predicate: a satellite has just lost its heartbeat when its computed
   * status is `offline` but its last recorded lifecycle edge still says it was
   * `connected`. Once the edge is mirrored (`lastConnectionEvent` becomes
   * `"heartbeat_lost"`), this returns false — the idempotency guarantee.
   */
  private hasLostHeartbeat(props: {
    status: "online" | "offline";
    lastConnectionEvent: SatelliteConnectionEvent | null;
  }): boolean {
    return props.status === "offline" && props.lastConnectionEvent === "connected";
  }
}
