import type { CacheManager } from "@checkstack/cache-api";
import {
  createCachedScope,
  type CachedScope,
} from "@checkstack/cache-utils";
import type { Logger } from "@checkstack/backend-api";

/**
 * 15s. The NotificationBell on every page polls `getUnreadCount` every 30s,
 * so even short caching provides huge savings. Mutations send signals to the
 * affected users which trigger frontend refetches — invalidation must
 * complete before the signal so the refetch hits a fresh DB read.
 */
const NOTIFICATION_TTL_MS = 15_000;

const UNREAD_PREFIX = "unread:";
const NOTIFS_PREFIX = "notifs:";
const SUBS_PREFIX = "subs:";

const unreadKey = (userId: string): string => `${UNREAD_PREFIX}${userId}`;
const subsKey = (userId: string): string => `${SUBS_PREFIX}${userId}`;

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

const notifsKey = (userId: string, filters: unknown): string =>
  `${NOTIFS_PREFIX}${userId}:${stableStringify(filters ?? {})}`;
const notifsPrefixForUser = (userId: string): string =>
  `${NOTIFS_PREFIX}${userId}:`;

export interface NotificationCache {
  wrapUnread: <T>(userId: string, loader: () => Promise<T>) => Promise<T>;
  wrapNotifications: <T>(
    userId: string,
    filters: unknown,
    loader: () => Promise<T>,
  ) => Promise<T>;
  wrapSubscriptions: <T>(
    userId: string,
    loader: () => Promise<T>,
  ) => Promise<T>;

  /**
   * Drop unread + notifications cache for a single user. Used after a
   * mutation that adds/removes/marks-as-read a notification for that user.
   */
  invalidateForUser: (userId: string) => Promise<void>;

  /** Drop subscriptions cache for one user (subscribe/unsubscribe). */
  invalidateSubscriptions: (userId: string) => Promise<void>;

  scope: CachedScope;
}

export function createNotificationCache({
  cacheManager,
  logger,
}: {
  cacheManager: CacheManager;
  logger: Logger;
}): NotificationCache {
  const scope = createCachedScope({
    cacheManager,
    pluginId: "notification",
    defaultTtlMs: NOTIFICATION_TTL_MS,
    onError: (op: string, error: unknown) => {
      logger.warn(`notification cache ${op} failed: ${String(error)}`);
    },
  });

  return {
    wrapUnread: (userId, loader) => scope.wrap(unreadKey(userId), loader),
    wrapNotifications: (userId, filters, loader) =>
      scope.wrap(notifsKey(userId, filters), loader),
    wrapSubscriptions: (userId, loader) =>
      scope.wrap(subsKey(userId), loader),

    invalidateForUser: async (userId) => {
      await Promise.all([
        scope.invalidate(unreadKey(userId)),
        scope.invalidatePrefix(notifsPrefixForUser(userId)),
      ]);
    },

    invalidateSubscriptions: (userId) => scope.invalidate(subsKey(userId)),

    scope,
  };
}
