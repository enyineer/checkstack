import type { CacheManager } from "@checkstack/cache-api";
import {
  createCachedScope,
  type CachedScope,
} from "@checkstack/cache-utils";
import type { Logger } from "@checkstack/backend-api";

/**
 * 25s — slightly under the dashboard's 30s `staleTime`. Catalog mutations
 * are infrequent (admin operations), so signal-driven invalidation is the
 * primary mechanism and TTL is a long safety net.
 */
const CATALOG_TTL_MS = 25_000;

/** Topology family: entities, systems, groups, per-system, groups-for-system. */
const ENTITY_PREFIX = "entity:";
const VIEW_PREFIX = "view:";
const CONTACTS_PREFIX = "contacts:";

const ENTITIES_KEY = `${ENTITY_PREFIX}entities`;
const SYSTEMS_KEY = `${ENTITY_PREFIX}systems`;
const GROUPS_KEY = `${ENTITY_PREFIX}groups`;
const VIEWS_KEY = `${VIEW_PREFIX}all`;

const systemKey = (id: string): string => `${ENTITY_PREFIX}system:${id}`;
const groupsForSystemKey = (systemId: string): string =>
  `${ENTITY_PREFIX}groups-for-system:${systemId}`;
const contactsKey = (systemId: string): string =>
  `${CONTACTS_PREFIX}${systemId}`;

export interface CatalogCache {
  /** Read-through caches for the dashboard hot paths. */
  wrapEntities: <T>(loader: () => Promise<T>) => Promise<T>;
  wrapSystems: <T>(loader: () => Promise<T>) => Promise<T>;
  wrapGroups: <T>(loader: () => Promise<T>) => Promise<T>;
  wrapSystem: <T>(systemId: string, loader: () => Promise<T>) => Promise<T>;
  wrapGroupsForSystem: <T>(
    systemId: string,
    loader: () => Promise<T>,
  ) => Promise<T>;
  wrapViews: <T>(loader: () => Promise<T>) => Promise<T>;
  wrapContacts: <T>(systemId: string, loader: () => Promise<T>) => Promise<T>;

  /**
   * Drop the whole topology family (entities, systems, groups, per-system,
   * groups-for-system). Used by every system/group/membership mutation —
   * `getEntities` already joins all four tables, so any change to any of
   * them logically affects every cached topology shape.
   */
  invalidateTopology: () => Promise<number>;

  /** Drop the views cache. */
  invalidateViews: () => Promise<number>;

  /** Drop one system's contact cache. */
  invalidateContacts: (systemId: string) => Promise<void>;

  scope: CachedScope;
}

export function createCatalogCache({
  cacheManager,
  logger,
}: {
  cacheManager: CacheManager;
  logger: Logger;
}): CatalogCache {
  const scope = createCachedScope({
    cacheManager,
    pluginId: "catalog",
    defaultTtlMs: CATALOG_TTL_MS,
    onError: (op: string, error: unknown) => {
      logger.warn(`catalog cache ${op} failed: ${String(error)}`);
    },
  });

  return {
    wrapEntities: (loader) => scope.wrap(ENTITIES_KEY, loader),
    wrapSystems: (loader) => scope.wrap(SYSTEMS_KEY, loader),
    wrapGroups: (loader) => scope.wrap(GROUPS_KEY, loader),
    wrapSystem: (systemId, loader) => scope.wrap(systemKey(systemId), loader),
    wrapGroupsForSystem: (systemId, loader) =>
      scope.wrap(groupsForSystemKey(systemId), loader),
    wrapViews: (loader) => scope.wrap(VIEWS_KEY, loader),
    wrapContacts: (systemId, loader) =>
      scope.wrap(contactsKey(systemId), loader),

    invalidateTopology: () => scope.invalidatePrefix(ENTITY_PREFIX),
    invalidateViews: () => scope.invalidatePrefix(VIEW_PREFIX),
    invalidateContacts: (systemId) => scope.invalidate(contactsKey(systemId)),

    scope,
  };
}
