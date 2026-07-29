import type { SatelliteStatus } from "@checkstack/satellite-common";
import { OFFLINE_THRESHOLD_MS } from "@checkstack/satellite-common";

/**
 * Compute satellite liveness status from its `lastHeartbeatAt` timestamp - the
 * SINGLE source of truth for presence. A satellite is `online` only while its
 * most recent heartbeat is within its offline threshold of now; a missing
 * timestamp (never connected / cleanly disconnected) or an aged one is
 * `offline`. Because this reads only durable, globally-shared state and a
 * wall-clock comparison, every pod computes the SAME answer and a stale row
 * self-heals to `offline` once the heartbeat ages out - no pod-local baseline,
 * no status that can get stuck `online` after a pod crash.
 *
 * `offlineThresholdMs` is the satellite's OWN tolerance, falling back to
 * {@link OFFLINE_THRESHOLD_MS} when unset. Every caller must pass the same
 * satellite's value: this function is the one liveness rule the entity read,
 * the admin list and the heartbeat monitor all share, so a caller that
 * silently used the default while another used the override would make the
 * same satellite read online in one place and offline in another.
 */
export function computeStatus({
  lastHeartbeatAt,
  offlineThresholdMs,
}: {
  lastHeartbeatAt: Date | null;
  offlineThresholdMs?: number | null;
}): SatelliteStatus {
  if (!lastHeartbeatAt) return "offline";
  const threshold = resolveOfflineThresholdMs({ offlineThresholdMs });
  const elapsed = Date.now() - lastHeartbeatAt.getTime();
  return elapsed <= threshold ? "online" : "offline";
}

/**
 * The effective offline threshold for a satellite.
 *
 * A null/undefined override means "use the platform default". A non-positive
 * stored value would make a satellite permanently offline, so it is treated as
 * unset rather than honoured - the column is not meant to be a kill switch.
 */
export function resolveOfflineThresholdMs({
  offlineThresholdMs,
}: {
  offlineThresholdMs?: number | null;
}): number {
  if (
    offlineThresholdMs === undefined ||
    offlineThresholdMs === null ||
    !Number.isFinite(offlineThresholdMs) ||
    offlineThresholdMs <= 0
  ) {
    return OFFLINE_THRESHOLD_MS;
  }
  return offlineThresholdMs;
}
