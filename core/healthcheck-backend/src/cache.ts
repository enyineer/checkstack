import type { CacheManager } from "@checkstack/cache-api";
import {
  createCachedScope,
  type CachedScope,
} from "@checkstack/cache-utils";
import type { Logger } from "@checkstack/backend-api";
import type { HealthCheckService } from "./service";

/**
 * TTL chosen to be slightly shorter than the dashboard's 30s `staleTime` so
 * that signal-driven invalidation almost always wins, and TTL only acts as
 * a safety net for paths that forget to invalidate.
 */
const STATUS_TTL_MS = 15_000;

/**
 * Per-entity cache helpers for the healthcheck plugin. Wrapping reads
 * goes through {@link wrapSystemHealthStatus}; mutations should call
 * {@link invalidateSystem} after the DB write but before emitting any
 * signal so that frontend refetches see fresh data.
 */
export interface HealthCheckCache {
  /** Read-through cache for one system's health status. */
  wrapSystemHealthStatus: (
    systemId: string,
    loader: () => ReturnType<HealthCheckService["getSystemHealthStatus"]>,
  ) => ReturnType<HealthCheckService["getSystemHealthStatus"]>;

  /** Invalidate a single system's cached status. */
  invalidateSystem: (systemId: string) => Promise<void>;

  /**
   * Invalidate every system's cached status. Used when the change can
   * affect many systems at once (e.g. a configuration update with
   * cross-system fan-out, or a plugin reload).
   */
  invalidateAllSystems: () => Promise<number>;

  /** Underlying scope, exposed for advanced callers. */
  scope: CachedScope;
}

const STATUS_KEY_PREFIX = "status:";
const statusKey = (systemId: string): string =>
  `${STATUS_KEY_PREFIX}${systemId}`;

export function createHealthCheckCache({
  cacheManager,
  logger,
}: {
  cacheManager: CacheManager;
  logger: Logger;
}): HealthCheckCache {
  const scope = createCachedScope({
    cacheManager,
    pluginId: "healthcheck",
    defaultTtlMs: STATUS_TTL_MS,
    onError: (op, error) => {
      logger.warn(`healthcheck cache ${op} failed: ${String(error)}`);
    },
  });

  return {
    wrapSystemHealthStatus: (systemId, loader) =>
      scope.wrap(statusKey(systemId), loader),
    invalidateSystem: (systemId) => scope.invalidate(statusKey(systemId)),
    invalidateAllSystems: () => scope.invalidatePrefix(STATUS_KEY_PREFIX),
    scope,
  };
}
