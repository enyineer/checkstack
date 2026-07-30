import type { CacheManager, CacheProvider } from "@checkstack/cache-api";
import { createScopedCache } from "@checkstack/cache-api";
import { pluginMetadata } from "@checkstack/satellite-common";

/**
 * Short-lived cache for "which satellites are online".
 *
 * ## Why this needs caching at all
 *
 * The health-check executor asks this question on EVERY tick of EVERY
 * satellite-only check, to decide whether nobody is running the check and a
 * degraded run should be recorded. The underlying read is a full scan of the
 * satellites table over a cross-plugin RPC, so without a cache a fleet with
 * many satellite-only checks turns one question into a query per check per
 * interval. See `.claude/rules/optimization.md`.
 *
 * ## Why the SHARED cache and not a Map
 *
 * The platform runs as N pods against one database. A pod-local `Map` would
 * give each pod its own view of satellite liveness, so two pods could disagree
 * about whether the same check is being executed. The shared provider gives one
 * coherence mechanism for the whole cluster.
 *
 * ## Why a TTL and no explicit invalidation
 *
 * Liveness is a function of wall-clock age, not of a write: a satellite goes
 * offline because time passed, with no mutation to hang an invalidation off.
 * So a short TTL is the honest mechanism.
 *
 * {@link LIVENESS_TTL_MS} is an order of magnitude below the smallest offline
 * threshold the schema allows (one heartbeat interval, 15s), so a cached answer
 * can never span a full online/offline transition. The worst case either way is
 * one tick of lag, which the next tick corrects: a stale "online" withholds one
 * degraded run, a stale "offline" records one that the next tick supersedes.
 */
export const LIVENESS_TTL_MS = 5000;

/** Cache key for the online-satellite id list. */
export const ONLINE_IDS_KEY = "liveness:online-ids";

export interface SatelliteLivenessCache {
  /**
   * Returns the cached online ids, or computes and stores them.
   *
   * A cache failure must never take out the caller: on any error the fresh
   * value is returned uncached, because a slow answer beats no answer when the
   * answer decides whether a monitoring gap is reported.
   */
  getOnlineIds(compute: () => Promise<string[]>): Promise<string[]>;
  /** Drop the cached value (satellite created / deleted). */
  invalidate(): Promise<void>;
}

export function createSatelliteLivenessCache({
  cacheManager,
}: {
  cacheManager: CacheManager;
}): SatelliteLivenessCache {
  const cache: CacheProvider = createScopedCache({
    pluginId: pluginMetadata.pluginId,
    provider: cacheManager.getProvider(),
  });

  return {
    async getOnlineIds(compute) {
      try {
        const cached = await cache.get<string[]>(ONLINE_IDS_KEY);
        if (cached) return cached;
      } catch {
        // Fall through and compute: an unreachable cache must degrade to the
        // uncached behaviour, not to an error.
      }

      const fresh = await compute();

      try {
        await cache.set(ONLINE_IDS_KEY, fresh, LIVENESS_TTL_MS);
      } catch {
        // Same: failing to STORE is not a reason to fail the read.
      }

      return fresh;
    },

    async invalidate() {
      try {
        await cache.delete(ONLINE_IDS_KEY);
      } catch {
        // The TTL bounds the staleness anyway, so a failed invalidation is at
        // worst LIVENESS_TTL_MS of lag - never a wrong answer for longer.
      }
    },
  };
}
