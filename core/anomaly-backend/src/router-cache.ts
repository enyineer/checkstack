import type { CacheManager } from "@checkstack/cache-api";
import {
  createCachedScope,
  type CachedScope,
} from "@checkstack/cache-utils";
import type { Logger } from "@checkstack/backend-api";

/**
 * Router-level cache for the anomaly plugin's read APIs.
 *
 * NOTE: This is a *separate* cache from the baseline cache the detector
 * uses (which lives in `detector.ts` / `jobs/baseline-analyzer.ts` and
 * keys by `baseline:...`). Keeping them in distinct prefixes lets us
 * invalidate one without touching the other.
 *
 * 15s TTL because the detector creates/updates anomaly rows on every
 * relevant check completion; we drop the cache on every detector write
 * but TTL acts as a freshness ceiling for any path that forgets.
 */
const ANOMALY_TTL_MS = 15_000;

const ANOMALIES_PREFIX = "anomalies:";
const BASELINES_PREFIX = "baselines:";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .join(",")}}`;
}

const anomaliesKey = (input: unknown): string =>
  `${ANOMALIES_PREFIX}${stableStringify(input ?? {})}`;
const baselinesKey = (input: unknown): string =>
  `${BASELINES_PREFIX}${stableStringify(input ?? {})}`;

export interface AnomalyRouterCache {
  wrapAnomalies: <T>(input: unknown, loader: () => Promise<T>) => Promise<T>;
  wrapBaselines: <T>(input: unknown, loader: () => Promise<T>) => Promise<T>;

  /**
   * Drop every cached anomaly list. Called by the detector after any
   * insert/update/delete on the anomalies table, before the
   * `ANOMALY_STATE_CHANGED` signal goes out, so frontend refetches see
   * fresh data.
   */
  invalidateAnomalies: () => Promise<number>;

  /**
   * Drop cached baseline list shapes — used after detector writes that
   * affect baselines.
   */
  invalidateBaselines: () => Promise<number>;

  scope: CachedScope;
}

export function createAnomalyRouterCache({
  cacheManager,
  logger,
}: {
  cacheManager: CacheManager;
  logger: Logger;
}): AnomalyRouterCache {
  const scope = createCachedScope({
    cacheManager,
    pluginId: "anomaly-router",
    defaultTtlMs: ANOMALY_TTL_MS,
    onError: (op: string, error: unknown) => {
      logger.warn(`anomaly router cache ${op} failed: ${String(error)}`);
    },
  });

  return {
    wrapAnomalies: (input, loader) => scope.wrap(anomaliesKey(input), loader),
    wrapBaselines: (input, loader) => scope.wrap(baselinesKey(input), loader),
    invalidateAnomalies: () => scope.invalidatePrefix(ANOMALIES_PREFIX),
    invalidateBaselines: () => scope.invalidatePrefix(BASELINES_PREFIX),
    scope,
  };
}
