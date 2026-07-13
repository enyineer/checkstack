/**
 * Resolver for the set of pattern ids a stream's health checks REFERENCE.
 *
 * A pattern referenced by a `pattern-occurrence` or `pattern-metric` collector
 * must never silently vanish: stale-pattern retention would orphan the check's
 * picker label and reset its `minutesSinceLastSeen` semantics, and Drain
 * eviction could re-mine the same template under a fresh id (zeroing the
 * watched id's counts). This resolver feeds the protected set to BOTH sides -
 * retention (excludes the referenced set) and the Drain engine (pins the
 * referenced clusters) - so the two stay coherent.
 *
 * It reuses the fast-path's cached cross-plugin config lookup exactly:
 * `HealthCheckApi.getConfigurations` -> filter to enabled `logstream.logstream`
 * configs for this stream -> collect `collectors[].config.patternId` from the
 * two pattern collectors. Cached 60s per stream (the plan's chosen staleness).
 */

import type { RpcClient } from "@checkstack/backend-api";
import type { CachedScope } from "@checkstack/cache-utils";
import { HealthCheckApi } from "@checkstack/healthcheck-common";
import { LOGSTREAM_QUALIFIED_STRATEGY_ID } from "./constants";
import { PATTERN_OCCURRENCE_COLLECTOR_ID } from "./pattern-occurrence-collector";
import { PATTERN_METRIC_COLLECTOR_ID } from "./pattern-metric-collector";

/** Resolve (cached) the pattern ids referenced by a stream's health checks. */
export type ResolveReferencedPatternIds = (
  streamId: string,
) => Promise<readonly string[]>;

/** Fully-qualified ids of the two pattern-referencing collectors. */
const PATTERN_OCCURRENCE_QUALIFIED = `logstream.${PATTERN_OCCURRENCE_COLLECTOR_ID}`;
const PATTERN_METRIC_QUALIFIED = `logstream.${PATTERN_METRIC_COLLECTOR_ID}`;

/**
 * Build the cached referenced-pattern resolver on the trusted cross-plugin RPC
 * client. Enumerates health-check configurations, keeps the enabled logstream
 * ones bound to `streamId`, and unions every `patternId` their pattern
 * collectors reference. Cached 60s per stream.
 */
export function createReferencedPatternResolver({
  rpcClient,
  cache,
  cacheTtlMs = 60_000,
}: {
  rpcClient: RpcClient;
  cache: CachedScope;
  cacheTtlMs?: number;
}): ResolveReferencedPatternIds {
  return (streamId: string) =>
    cache.wrap(
      `referenced-patterns:${streamId}`,
      async () => {
        const client = rpcClient.forPlugin(HealthCheckApi);
        const { configurations } = await client.getConfigurations();
        const referenced = new Set<string>();
        for (const config of configurations) {
          if (config.strategyId !== LOGSTREAM_QUALIFIED_STRATEGY_ID) continue;
          if (readStreamId(config.config) !== streamId) continue;
          for (const collector of config.collectors ?? []) {
            if (
              collector.collectorId !== PATTERN_OCCURRENCE_QUALIFIED &&
              collector.collectorId !== PATTERN_METRIC_QUALIFIED
            ) {
              continue;
            }
            const patternId = readPatternId(collector.config);
            if (patternId) referenced.add(patternId);
          }
        }
        return [...referenced];
      },
      { ttlMs: cacheTtlMs },
    );
}

/**
 * Look up the NAMES of the health checks that reference a specific pattern of a
 * stream. Used by `deletePattern` to refuse (409) a delete that would orphan a
 * check's picker label, and to name the offending checks in the error. Not
 * cached (deletes are rare and want a fresh answer). Returns `[]` when the RPC
 * client is unavailable (no health checks can exist without it).
 */
export type FindReferencingChecks = (input: {
  streamId: string;
  patternId: string;
}) => Promise<string[]>;

export function createPatternReferenceChecker({
  rpcClient,
}: {
  rpcClient: RpcClient | undefined;
}): FindReferencingChecks {
  return async ({ streamId, patternId }) => {
    if (!rpcClient) return [];
    const client = rpcClient.forPlugin(HealthCheckApi);
    const { configurations } = await client.getConfigurations();
    const names: string[] = [];
    for (const config of configurations) {
      if (config.strategyId !== LOGSTREAM_QUALIFIED_STRATEGY_ID) continue;
      if (readStreamId(config.config) !== streamId) continue;
      const references = (config.collectors ?? []).some(
        (collector) =>
          (collector.collectorId === PATTERN_OCCURRENCE_QUALIFIED ||
            collector.collectorId === PATTERN_METRIC_QUALIFIED) &&
          readPatternId(collector.config) === patternId,
      );
      if (references) names.push(config.name);
    }
    return names;
  };
}

/** Read `streamId` from a stored strategy config record (no cast to any). */
function readStreamId(config: Record<string, unknown>): string | undefined {
  const value = config.streamId;
  return typeof value === "string" ? value : undefined;
}

/** Read `patternId` from a stored collector config record (no cast to any). */
function readPatternId(config: Record<string, unknown>): string | undefined {
  const value = config.patternId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
