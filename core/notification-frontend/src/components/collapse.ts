import type { Notification } from "@checkstack/notification-common";

/**
 * A group of related notifications that share a `collapseKey`. The newest
 * notification (`representative`) drives the rendered title/body/action;
 * `count` is the total number of notifications in the group;
 * `notifications` is the full chronological list (newest first) for
 * timeline expansion.
 */
export interface CollapsedNotification {
  /** Unique key for React reconciliation. The collapse key, or the notification id when no collapse key is set. */
  key: string;
  /** Whether this group represents multiple underlying notifications. */
  collapsed: boolean;
  count: number;
  representative: Notification;
  notifications: Notification[];
}

/**
 * Group notifications by `collapseKey`. Notifications without a key remain
 * as singletons. Within a group, the representative is the newest by
 * `createdAt`. Group order is the order of first appearance in the input,
 * so a list ordered by `createdAt desc` produces groups whose order
 * matches their newest member.
 */
export function groupByCollapseKey(
  notifications: readonly Notification[],
): CollapsedNotification[] {
  const order: string[] = [];
  const groups = new Map<string, Notification[]>();

  for (const n of notifications) {
    const key = n.collapseKey ?? `__nokey:${n.id}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(n);
  }

  return order.map((key) => {
    const items = groups.get(key)!;
    // Sort newest first within the group; createdAt is a Date in the
    // schema-validated response.
    const sorted = items.toSorted(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const representative = sorted[0]!;
    return {
      key,
      collapsed: sorted.length > 1,
      count: sorted.length,
      representative,
      notifications: sorted,
    };
  });
}
