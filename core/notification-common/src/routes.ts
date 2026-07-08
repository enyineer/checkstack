import { createRoutes } from "@checkstack/common";

/**
 * Route definitions for the notification plugin.
 */
export const notificationRoutes = createRoutes("notification", {
  home: "/",
  settings: "/settings",
  /**
   * Per-user subscription management, moved off the settings page into its own
   * surface + nav entry. Same authenticated-only visibility as settings.
   */
  subscriptions: "/subscriptions",
  /**
   * Admin-only visibility surface for per-channel delivery attempts.
   * Visibility, not a dashboard — see Phase 8 of the v1 polishing
   * plan and `docs/.../backend/notification-delivery.md`.
   */
  deliveryAttempts: "/delivery-attempts",
});
