import type { CacheManager } from "@checkstack/cache-api";
import {
  createCachedScope,
  type CachedScope,
} from "@checkstack/cache-utils";
import type { Logger } from "@checkstack/backend-api";
import type { IncidentService } from "./service";

/**
 * 15s — comfortably under the dashboard's 30s `staleTime` so signal-driven
 * invalidation almost always wins, and TTL only acts as a safety net.
 */
const INCIDENT_TTL_MS = 15_000;

const LIST_PREFIX = "list:";
const INCIDENT_PREFIX = "incident:";
const SYSTEM_PREFIX = "system:";

const incidentKey = (id: string): string => `${INCIDENT_PREFIX}${id}`;
const systemKey = (systemId: string): string => `${SYSTEM_PREFIX}${systemId}`;

/**
 * Stable JSON for filter shapes — sort keys so {a:1,b:2} and {b:2,a:1}
 * collapse to the same cache key. Filter shapes here are tiny (<10 fields)
 * so a recursive sort is cheap and the resulting key is human-readable.
 */
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

const listKey = (filters: unknown): string =>
  `${LIST_PREFIX}${stableStringify(filters ?? {})}`;

type ListResult = Awaited<ReturnType<IncidentService["listIncidents"]>>;
type IncidentResult = Awaited<ReturnType<IncidentService["getIncident"]>>;
type SystemResult = Awaited<ReturnType<IncidentService["getIncidentsForSystem"]>>;

export interface IncidentCache {
  /** Read-through cache for {@link IncidentService.listIncidents}. */
  wrapList: (
    filters: unknown,
    loader: () => Promise<ListResult>,
  ) => Promise<ListResult>;

  /** Read-through cache for {@link IncidentService.getIncident}. */
  wrapIncident: (
    id: string,
    loader: () => Promise<IncidentResult>,
  ) => Promise<IncidentResult>;

  /** Read-through cache for {@link IncidentService.getIncidentsForSystem}. */
  wrapSystem: (
    systemId: string,
    loader: () => Promise<SystemResult>,
  ) => Promise<SystemResult>;

  /**
   * Invalidate everything affected by a mutation on `incidentId` that
   * touches `systemIds`. Drops:
   *  - the per-incident cache entry
   *  - every per-system cache entry for the affected systems
   *  - every cached list shape (any filter could match)
   *
   * Must be awaited *before* emitting `INCIDENT_UPDATED` signals so any
   * frontend that refetches in response sees fresh data.
   */
  invalidateForMutation: (props: {
    incidentId: string;
    systemIds: readonly string[];
  }) => Promise<void>;

  /** Invalidate every cached entry for one system (used on system deletion). */
  invalidateSystem: (systemId: string) => Promise<void>;

  scope: CachedScope;
}

export function createIncidentCache({
  cacheManager,
  logger,
}: {
  cacheManager: CacheManager;
  logger: Logger;
}): IncidentCache {
  const scope = createCachedScope({
    cacheManager,
    pluginId: "incident",
    defaultTtlMs: INCIDENT_TTL_MS,
    onError: (op, error) => {
      logger.warn(`incident cache ${op} failed: ${String(error)}`);
    },
  });

  return {
    wrapList: (filters, loader) => scope.wrap(listKey(filters), loader),
    wrapIncident: (id, loader) => scope.wrap(incidentKey(id), loader),
    wrapSystem: (systemId, loader) => scope.wrap(systemKey(systemId), loader),

    invalidateForMutation: async ({ incidentId, systemIds }) => {
      await Promise.all([
        scope.invalidate(incidentKey(incidentId)),
        ...systemIds.map((systemId) =>
          scope.invalidate(systemKey(systemId)),
        ),
        scope.invalidatePrefix(LIST_PREFIX),
      ]);
    },

    invalidateSystem: async (systemId) => {
      await Promise.all([
        scope.invalidate(systemKey(systemId)),
        scope.invalidatePrefix(LIST_PREFIX),
      ]);
    },

    scope,
  };
}
