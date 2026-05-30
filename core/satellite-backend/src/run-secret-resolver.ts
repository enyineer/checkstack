import { secretEnvMappingSchema } from "@checkstack/secrets-common";
import type { SecretResolverService } from "@checkstack/secrets-backend";
import type { SatelliteAssignment } from "@checkstack/satellite-common";

/**
 * Resolve a satellite collector run's secrets just-in-time.
 *
 * Security model (least-privilege, decision 5): the satellite asks by
 * `configId` + `collectorId` only. Core reads the `secretEnv` mapping from
 * the satellite's OWN persisted assignment for that collector — the
 * satellite does not get to choose which secrets — and resolves ONLY those
 * refs via the central resolver. So a compromised satellite cannot request
 * arbitrary secrets; it can only obtain what its assignment already
 * declares it needs.
 *
 * Returns the resolved env map. Throws a clear error when the collector
 * isn't in the satellite's assignments, when the collector declares no
 * `secretEnv` (nothing to resolve — caller should not have asked), or when
 * a referenced secret can't be resolved. The values are never persisted.
 */
export async function resolveSatelliteRunSecrets({
  satelliteId,
  configId,
  collectorId,
  getAssignmentsForSatellite,
  resolver,
}: {
  satelliteId: string;
  configId: string;
  collectorId: string;
  getAssignmentsForSatellite: (
    satelliteId: string,
  ) => Promise<SatelliteAssignment[]>;
  resolver: SecretResolverService;
}): Promise<Record<string, string>> {
  const assignments = await getAssignmentsForSatellite(satelliteId);
  const assignment = assignments.find((a) => a.configId === configId);
  if (!assignment) {
    throw new Error(
      `No assignment "${configId}" for this satellite; cannot deliver secrets.`,
    );
  }

  const collector = (assignment.collectors ?? []).find(
    (c) => c.id === collectorId || c.collectorId === collectorId,
  );
  if (!collector) {
    throw new Error(
      `Collector "${collectorId}" not found in assignment "${configId}".`,
    );
  }

  // The declared mapping lives inside the collector's config. Validate it so
  // a malformed config can't smuggle non-template values through.
  const parsed = secretEnvMappingSchema.safeParse(
    (collector.config as { secretEnv?: unknown }).secretEnv,
  );
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    throw new Error(
      `Collector "${collectorId}" declares no secretEnv; nothing to resolve.`,
    );
  }

  const { env } = await resolver.resolveForRun({ secretEnv: parsed.data });
  return env;
}
