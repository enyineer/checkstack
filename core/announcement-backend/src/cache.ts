import type { CacheManager } from "@checkstack/cache-api";
import {
  createCachedScope,
  type CachedScope,
} from "@checkstack/cache-utils";
import type { Logger } from "@checkstack/backend-api";

/** 45s — admin-driven, infrequently changing data. */
const ANNOUNCEMENT_TTL_MS = 45_000;

const ACTIVE_PREFIX = "active:";
const LIST_ALL_KEY = "list:all";

const activeKeyForUser = (userId: string, includeDismissed: boolean): string =>
  `${ACTIVE_PREFIX}user:${userId}:${includeDismissed ? "all" : "undismissed"}`;
const activeKeyForAnon = (includeDismissed: boolean): string =>
  `${ACTIVE_PREFIX}anon:${includeDismissed ? "all" : "undismissed"}`;
const userActivePrefix = (userId: string): string =>
  `${ACTIVE_PREFIX}user:${userId}:`;

export interface AnnouncementCache {
  wrapActive: <T>(
    props: { userId: string | undefined; includeDismissed: boolean },
    loader: () => Promise<T>,
  ) => Promise<T>;
  wrapListAll: <T>(loader: () => Promise<T>) => Promise<T>;

  /** Drop all cached active-announcement results for every user. */
  invalidateAllActive: () => Promise<number>;

  /** Drop just one user's active-announcement cache (e.g. on dismissal). */
  invalidateUserActive: (userId: string) => Promise<number>;

  /** Drop the admin list cache. */
  invalidateListAll: () => Promise<void>;

  scope: CachedScope;
}

export function createAnnouncementCache({
  cacheManager,
  logger,
}: {
  cacheManager: CacheManager;
  logger: Logger;
}): AnnouncementCache {
  const scope = createCachedScope({
    cacheManager,
    pluginId: "announcement",
    defaultTtlMs: ANNOUNCEMENT_TTL_MS,
    onError: (op: string, error: unknown) => {
      logger.warn(`announcement cache ${op} failed: ${String(error)}`);
    },
  });

  return {
    wrapActive: ({ userId, includeDismissed }, loader) => {
      const key =
        userId === undefined
          ? activeKeyForAnon(includeDismissed)
          : activeKeyForUser(userId, includeDismissed);
      return scope.wrap(key, loader);
    },
    wrapListAll: (loader) => scope.wrap(LIST_ALL_KEY, loader),

    invalidateAllActive: () => scope.invalidatePrefix(ACTIVE_PREFIX),
    invalidateUserActive: (userId) =>
      scope.invalidatePrefix(userActivePrefix(userId)),
    invalidateListAll: () => scope.invalidate(LIST_ALL_KEY),

    scope,
  };
}
