import type { CacheManager } from "@checkstack/cache-api";
import {
  createCachedScope,
  type CachedScope,
} from "@checkstack/cache-utils";
import type { Logger } from "@checkstack/backend-api";
import type { MaintenanceService } from "./service";

const MAINTENANCE_TTL_MS = 15_000;

const LIST_PREFIX = "list:";
const MAINTENANCE_PREFIX = "maintenance:";
const SYSTEM_PREFIX = "system:";

const maintenanceKey = (id: string): string => `${MAINTENANCE_PREFIX}${id}`;
const systemKey = (systemId: string): string => `${SYSTEM_PREFIX}${systemId}`;

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

type ListResult = Awaited<ReturnType<MaintenanceService["listMaintenances"]>>;
type MaintenanceResult = Awaited<
  ReturnType<MaintenanceService["getMaintenance"]>
>;
type SystemResult = Awaited<
  ReturnType<MaintenanceService["getMaintenancesForSystem"]>
>;

export interface MaintenanceCache {
  wrapList: (
    filters: unknown,
    loader: () => Promise<ListResult>,
  ) => Promise<ListResult>;
  wrapMaintenance: (
    id: string,
    loader: () => Promise<MaintenanceResult>,
  ) => Promise<MaintenanceResult>;
  wrapSystem: (
    systemId: string,
    loader: () => Promise<SystemResult>,
  ) => Promise<SystemResult>;

  /**
   * Drops the per-maintenance entry, every per-system entry for the
   * affected systems, and every cached list shape. Must be awaited
   * before emitting `MAINTENANCE_UPDATED` so frontend refetches see
   * fresh data.
   */
  invalidateForMutation: (props: {
    maintenanceId: string;
    systemIds: readonly string[];
  }) => Promise<void>;

  invalidateSystem: (systemId: string) => Promise<void>;

  scope: CachedScope;
}

export function createMaintenanceCache({
  cacheManager,
  logger,
}: {
  cacheManager: CacheManager;
  logger: Logger;
}): MaintenanceCache {
  const scope = createCachedScope({
    cacheManager,
    pluginId: "maintenance",
    defaultTtlMs: MAINTENANCE_TTL_MS,
    onError: (op, error) => {
      logger.warn(`maintenance cache ${op} failed: ${String(error)}`);
    },
  });

  return {
    wrapList: (filters, loader) => scope.wrap(listKey(filters), loader),
    wrapMaintenance: (id, loader) =>
      scope.wrap(maintenanceKey(id), loader),
    wrapSystem: (systemId, loader) => scope.wrap(systemKey(systemId), loader),

    invalidateForMutation: async ({ maintenanceId, systemIds }) => {
      await Promise.all([
        scope.invalidate(maintenanceKey(maintenanceId)),
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
