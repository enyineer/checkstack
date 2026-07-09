import type { CacheManager } from "@checkstack/cache-api";
import { createCachedScope, type CachedScope } from "@checkstack/cache-utils";
import type { Logger } from "@checkstack/backend-api";
import type { SystemHealthStatusResponse } from "@checkstack/healthcheck-common";
import { statusVectorChanged } from "./status-fingerprint";

/**
 * TTL for a cached status entry. With a distributed backend (Redis) configured,
 * the TTL is only a natural refresh / safety net — cross-pod coherence comes
 * from the SHARED store (a `delete` on one pod is visible to all), not from the
 * TTL. On the default in-memory backend the entry is per-pod; that backend is
 * for single-instance deployments (see the caching-architecture docs).
 */
const STATUS_TTL_MS = 15_000;

const STATUS_KEY_PREFIX = "status:";

/**
 * Per-(system, environment) cache key.
 *
 * `environmentId` collapses `undefined` (the system ROLLUP, all runs) and `null`
 * (the env-less slice) to the SAME bare key `status:<systemId>`, because an
 * env-less run IS the rollup (it mutates the bare `<systemId>` entity). A real
 * environment id gets its own `status:<systemId>:<environmentId>` key. This
 * matches the (systemId, environmentId) tuple both the reader
 * (`getSystemHealthStatus`) and the executor's per-env write use.
 */
function statusKey(systemId: string, environmentId?: string | null): string {
  return environmentId === undefined || environmentId === null
    ? `${STATUS_KEY_PREFIX}${systemId}`
    : `${STATUS_KEY_PREFIX}${systemId}:${environmentId}`;
}

/** Prefix covering a single system's rollup key AND all its per-env keys. */
function systemPrefix(systemId: string): string {
  return `${STATUS_KEY_PREFIX}${systemId}`;
}

/**
 * Minimal read surface the cache needs. `HealthCheckService` satisfies it
 * structurally; a narrow interface keeps the cache testable with a stub and
 * documents that the cache is the ONLY sanctioned caller of the raw
 * `getSystemHealthStatus` read (enforced by the `no-direct-system-status-read`
 * lint rule everywhere except this module and the executor/entity compute
 * paths).
 */
export interface HealthStatusReader {
  getSystemHealthStatus(
    systemId: string,
    environmentId?: string | null,
  ): Promise<SystemHealthStatusResponse>;
  /** Distinct environment ids a system currently has runs for (env-less excluded). */
  getSystemEnvironmentIds(systemId: string): Promise<string[]>;
}

/** Per-(system, check, environment) matrix — see {@link HealthCheckCache.readMatrix}. */
export type SystemHealthMatrix = Record<
  string,
  {
    status: SystemHealthStatusResponse["status"];
    checkStatuses: SystemHealthStatusResponse["checkStatuses"];
    environments: Record<
      string,
      {
        status: SystemHealthStatusResponse["status"];
        checkStatuses: SystemHealthStatusResponse["checkStatuses"];
      }
    >;
  }
>;

/**
 * The system-health status cache — a platform interface that is the SINGLE
 * sanctioned reader AND invalidator of a system's derived health status.
 *
 * It is built on the platform {@link CacheManager} (via {@link createCachedScope}),
 * so the active backend is a per-deployment choice: the default in-memory
 * backend (per-pod, single-instance) or a distributed backend such as Redis
 * (shared across pods). Cross-pod coherence therefore comes from the SHARED
 * store — an `invalidate` is a `delete` every pod sees — NOT from any
 * application-level broadcast. Horizontal scaling requires a distributed backend
 * (see `docs/.../architecture/caching.md`).
 *
 * Reads (`read` / `readBulk` / `readMatrix`) serve the RAW (pre-incident-override)
 * status; the router folds incident overrides downstream, so an incident change
 * never touches this cache. `reconcile` is the hot-path invalidator: it evicts
 * ONLY when the per-check status vector actually changed ({@link statusVectorChanged}),
 * so a run that merely refreshes timestamps keeps the cache warm.
 */
export interface HealthCheckCache {
  /** Read-through cache for one (system, environment) status (RAW, pre-override). */
  read(
    systemId: string,
    environmentId?: string,
  ): Promise<SystemHealthStatusResponse>;

  /** Per-entity read-through cache for many systems' rollup status. */
  readBulk(
    systemIds: string[],
    environmentId?: string,
  ): Promise<Record<string, SystemHealthStatusResponse>>;

  /**
   * Per-(system, check, environment) matrix assembled from cached rollup +
   * per-environment reads. The env set is discovered live per system; each
   * slice read hits the same per-env cache the badge path warms.
   */
  readMatrix(systemIds: string[]): Promise<SystemHealthMatrix>;

  /**
   * Change-gated invalidator for the run hot path. Evicts the (system,
   * environment) key ONLY when the derived status vector changed between
   * `previous` and `next`; a no-op otherwise so a timestamp-only run keeps the
   * cache warm. A per-environment change also evicts the system rollup key
   * (the slice feeds the worst-wins rollup).
   */
  reconcile(args: {
    systemId: string;
    /** `null`/absent = the rollup / env-less key; a string = that environment. */
    environmentId?: string | null;
    previous: SystemHealthStatusResponse;
    next: SystemHealthStatusResponse;
  }): Promise<void>;

  /** Evict a system's rollup + every per-env key. */
  invalidateSystem(systemId: string): Promise<void>;

  /** Evict every system's status. Returns keys removed. */
  invalidateAllSystems(): Promise<number>;
}

export function createHealthCheckCache({
  cacheManager,
  logger,
  service,
}: {
  cacheManager: CacheManager;
  logger: Logger;
  /** Read source for cache misses. `HealthCheckService` satisfies this. */
  service: HealthStatusReader;
}): HealthCheckCache {
  const scope: CachedScope = createCachedScope({
    cacheManager,
    pluginId: "healthcheck",
    defaultTtlMs: STATUS_TTL_MS,
    onError: (op, error) => {
      logger.warn(`healthcheck cache ${op} failed: ${String(error)}`);
    },
  });

  const read: HealthCheckCache["read"] = (systemId, environmentId) =>
    scope.wrap(statusKey(systemId, environmentId), () =>
      service.getSystemHealthStatus(systemId, environmentId),
    );

  const readBulk: HealthCheckCache["readBulk"] = async (
    systemIds,
    environmentId,
  ) => {
    const values = await scope.wrapMany(systemIds, {
      keyFor: (id) => statusKey(id, environmentId),
      loader: (id) => service.getSystemHealthStatus(id, environmentId),
    });
    const out: Record<string, SystemHealthStatusResponse> = {};
    for (const [i, id] of systemIds.entries()) {
      out[id] = values[i]!;
    }
    return out;
  };

  const readMatrix: HealthCheckCache["readMatrix"] = async (systemIds) => {
    const result: SystemHealthMatrix = {};
    await Promise.all(
      systemIds.map(async (systemId) => {
        const overall = await read(systemId);
        const envIds = await service.getSystemEnvironmentIds(systemId);
        const environments: SystemHealthMatrix[string]["environments"] = {};
        await Promise.all(
          envIds.map(async (environmentId) => {
            const slice = await read(systemId, environmentId);
            environments[environmentId] = {
              status: slice.status,
              checkStatuses: slice.checkStatuses,
            };
          }),
        );
        result[systemId] = {
          status: overall.status,
          checkStatuses: overall.checkStatuses,
          environments,
        };
      }),
    );
    return result;
  };

  const reconcile: HealthCheckCache["reconcile"] = async ({
    systemId,
    environmentId,
    previous,
    next,
  }) => {
    if (!statusVectorChanged(previous, next)) return; // vector unchanged: keep warm.
    // `scope.invalidate` is a `delete` on the active backend. With a distributed
    // backend that delete is visible to every pod immediately, so no broadcast
    // is needed for cross-pod coherence.
    const isEnvScoped =
      environmentId !== undefined && environmentId !== null;
    if (isEnvScoped) {
      // A per-environment slice changed. Evict its key AND the system rollup:
      // the slice feeds the worst-wins rollup, so the rollup value may have
      // moved even when its OWN per-check fingerprint can't see it (one slice
      // recovering as another fails keeps `failingSliceCount` put). Sibling env
      // keys stay warm.
      await scope.invalidate(statusKey(systemId, environmentId));
      await scope.invalidate(statusKey(systemId));
    } else {
      // Env-less / rollup change: the bare key IS the rollup.
      await scope.invalidate(statusKey(systemId));
    }
  };

  const invalidateSystem: HealthCheckCache["invalidateSystem"] = async (
    systemId,
  ) => {
    await scope.invalidatePrefix(systemPrefix(systemId));
  };

  const invalidateAllSystems: HealthCheckCache["invalidateAllSystems"] = () =>
    scope.invalidatePrefix(STATUS_KEY_PREFIX);

  return {
    read,
    readBulk,
    readMatrix,
    reconcile,
    invalidateSystem,
    invalidateAllSystems,
  };
}
