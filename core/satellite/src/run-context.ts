import type {
  SatelliteAssignment,
  SatelliteEnvironment,
} from "@checkstack/satellite-common";
import type { CollectorRunContext } from "@checkstack/backend-api";

/**
 * Build the curated, read-only run-context metadata exposed to collectors
 * from a satellite assignment and the ONE environment this run is for.
 *
 * Mirrors the core queue-executor's run-context, including its `environment`
 * block - so `{{ environment.<key> }}` resolves on a satellite exactly as it
 * does locally. An env-less run omits the block entirely, as the core does.
 *
 * The `configName` and `systemName` assignment fields are optional for
 * version-skew safety, so they fall back to the corresponding IDs when absent.
 */
export function buildRunContext({
  assignment,
  environment,
}: {
  assignment: SatelliteAssignment;
  environment?: SatelliteEnvironment | null;
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
    ...(environment
      ? {
          environment: {
            id: environment.id,
            name: environment.name,
            fields: environment.fields ?? {},
          },
        }
      : {}),
  };
}
