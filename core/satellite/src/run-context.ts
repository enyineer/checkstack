import type { SatelliteAssignment } from "@checkstack/satellite-common";
import type { CollectorRunContext } from "@checkstack/backend-api";

/**
 * Build the curated, read-only run-context metadata exposed to collectors
 * from a satellite assignment.
 *
 * Mirrors the core queue-executor's run-context. The `configName` and
 * `systemName` assignment fields are optional for version-skew safety, so
 * they fall back to the corresponding IDs when absent.
 */
export function buildRunContext({
  assignment,
}: {
  assignment: SatelliteAssignment;
}): CollectorRunContext {
  return {
    check: {
      id: assignment.configId,
      name: assignment.configName ?? assignment.configId,
      intervalSeconds: assignment.intervalSeconds,
    },
    system: {
      id: assignment.systemId,
      name: assignment.systemName ?? assignment.systemId,
      metadata: assignment.systemMetadata ?? {},
    },
  };
}
