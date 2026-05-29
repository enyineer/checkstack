import { createHook } from "@checkstack/backend-api";

/**
 * Notification-backend hooks for cross-plugin reaction.
 *
 * Emitted from the shared `dispatchWithAttempt` funnel — so every
 * external delivery (whether triggered by `notifyForSubscription`,
 * `sendTransactional`, or any future fan-out path) is observable via
 * the same two hooks. Internal-only notifications (those not sent via
 * an external strategy) don't fire these.
 */
export const notificationHooks = {
  /**
   * Emitted when a delivery attempt succeeded for a specific strategy.
   * Carries enough to correlate against the persisted attempt row
   * (`notificationDeliveryAttempts.notificationId + strategyQualifiedId`)
   * without forcing subscribers to round-trip the DB.
   */
  delivered: createHook<{
    notificationId: string;
    strategyQualifiedId: string;
    durationMs: number;
    timestamp: string;
  }>("notification.delivered"),

  /**
   * Emitted when a delivery attempt failed (either the strategy
   * returned `success: false` or `.send(...)` threw). `errorMessage`
   * is the same already-sanitised string written to the attempt row.
   */
  failed: createHook<{
    notificationId: string;
    strategyQualifiedId: string;
    errorMessage: string;
    durationMs: number;
    timestamp: string;
  }>("notification.failed"),
} as const;
