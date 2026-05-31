import type { SatelliteStatus } from "@checkstack/satellite-common";
import { OFFLINE_THRESHOLD_MS } from "@checkstack/satellite-common";

/**
 * Compute satellite liveness status from its `lastHeartbeatAt` timestamp — the
 * SINGLE source of truth for presence. A satellite is `online` only while its
 * most recent heartbeat is within {@link OFFLINE_THRESHOLD_MS} of now; a missing
 * timestamp (never connected / cleanly disconnected) or an aged one is
 * `offline`. Because this reads only durable, globally-shared state and a
 * wall-clock comparison, every pod computes the SAME answer and a stale row
 * self-heals to `offline` once the heartbeat ages out — no pod-local baseline,
 * no status that can get stuck `online` after a pod crash.
 */
export function computeStatus(lastHeartbeatAt: Date | null): SatelliteStatus {
  if (!lastHeartbeatAt) return "offline";
  const elapsed = Date.now() - lastHeartbeatAt.getTime();
  return elapsed <= OFFLINE_THRESHOLD_MS ? "online" : "offline";
}
