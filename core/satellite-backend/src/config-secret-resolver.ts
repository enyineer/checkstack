import type {
  HealthCheckRegistry,
  CollectorRegistry,
} from "@checkstack/backend-api";
import type { SatelliteAssignment } from "@checkstack/satellite-common";
import {
  collectConfigSecretValues,
  type HealthCheckSecretsDeps,
} from "@checkstack/healthcheck-backend";

/**
 * Resolve a satellite assignment's CONFIG secrets just-in-time (decision 5,
 * least-privilege): the satellite asks by `configId` only; core walks the
 * satellite's OWN persisted assignment - the strategy config plus each
 * collector entry's config - and resolves every `x-secret` field holding an
 * internal marker or a `${{ secrets.* }}` reference. Legacy bare literals
 * produce no entry (the satellite already holds them verbatim).
 *
 * A compromised satellite can only obtain the credentials its assignments
 * already embed; values are returned over the authenticated WS channel and
 * never persisted.
 */
export async function resolveSatelliteConfigSecrets({
  satelliteId,
  configId,
  getAssignmentsForSatellite,
  registry,
  collectorRegistry,
  deps,
}: {
  satelliteId: string;
  configId: string;
  getAssignmentsForSatellite: (
    satelliteId: string,
  ) => Promise<SatelliteAssignment[]>;
  registry: HealthCheckRegistry;
  collectorRegistry: CollectorRegistry;
  deps: HealthCheckSecretsDeps;
}): Promise<{
  strategy: Record<string, string>;
  collectors: Record<string, Record<string, string>>;
}> {
  const assignments = await getAssignmentsForSatellite(satelliteId);
  const assignment = assignments.find((a) => a.configId === configId);
  if (!assignment) {
    throw new Error(
      `No assignment "${configId}" for this satellite; cannot deliver config secrets.`,
    );
  }

  const strategySchema = registry.getStrategy(
    assignment.strategyId,
  )?.config.schema;
  const strategy = strategySchema
    ? await collectConfigSecretValues({
        configurationId: configId,
        scope: { kind: "strategy" },
        schema: strategySchema,
        config: assignment.config,
        deps,
      })
    : {};

  const collectors: Record<string, Record<string, string>> = {};
  for (const entry of assignment.collectors ?? []) {
    const schema = collectorRegistry.getCollector(entry.collectorId)?.collector
      .config.schema;
    if (!schema) continue;
    const values = await collectConfigSecretValues({
      configurationId: configId,
      scope: { kind: "collector", entryId: entry.id },
      schema,
      config: entry.config,
      deps,
    });
    if (Object.keys(values).length > 0) collectors[entry.id] = values;
  }

  return { strategy, collectors };
}
