import { createExtensionPoint } from "@checkstack/backend-api";
import type { PluginMetadata } from "@checkstack/common";

/**
 * External-audience fan-out for `notifyForSubscription`.
 *
 * Every notification source (incident, maintenance, health) funnels through
 * `notifyForSubscription`, which fans a notification out to the subscribed AUTH
 * USERS. Some audiences are NOT auth users though - e.g. anonymous status-page
 * email subscribers. Rather than have each domain plugin know about those
 * audiences, notification-backend (platform) DEFINES this extension point and an
 * owning plugin (status-page, platform) CONTRIBUTES a sink. The sink is invoked
 * ONCE per notification, in-process, on the single pod that handled the RPC - so
 * exactly one delivery happens (it is a point RPC, not a cluster broadcast).
 *
 * Dependency direction: notification-backend defines the contract; the
 * contributor imports notification-backend. notification-backend imports no
 * contributor and no domain plugin.
 */
export interface NotificationAudienceEvent {
  /** Notification title. */
  title: string;
  /** Notification body (markdown; already includes the update text). */
  body: string;
  importance: "info" | "warning" | "critical";
  /**
   * Concrete affected catalog system ids (from `catalog.system` subjects, else
   * the spec's resourceKeys). A group-scoped audience (e.g. a status page)
   * expands groups itself against its OWN live source at send time, so the event
   * intentionally carries only the concrete systems - notification-backend never
   * expands catalog groups (which would be a second, drift-prone source).
   */
  systemIds: string[];
  /** The subscription spec's owning plugin (incident / maintenance / healthcheck). */
  sourcePluginId: string;
  /**
   * The catalog ENVIRONMENT id an env-scoped change (a per-environment health
   * transition) originated in. OPAQUE to notification-backend. A group-scoped
   * sink (status page) uses it to drop a change that happened in an environment
   * the page does not publish. Absent for env-less sources (incident,
   * maintenance) and system-rollup health notifications.
   */
  originEnvironmentId?: string;
  /** Optional deep link (the notification's primary action URL). */
  link?: string;
}

export interface NotificationAudienceSink {
  /** Deliver a notification to an external (non-auth-user) audience. */
  deliver(event: NotificationAudienceEvent): Promise<void>;
}

export interface NotificationAudienceExtensionPoint {
  registerAudienceSink(
    sink: NotificationAudienceSink,
    pluginMetadata: PluginMetadata,
  ): void;
}

export interface NotificationAudienceRegistry {
  extensionPoint: NotificationAudienceExtensionPoint;
  /** The registered sinks, read by the dispatch path. */
  list(): NotificationAudienceSink[];
}

/** Simple in-process registry of audience sinks (mirrors the strategy registry). */
export function createNotificationAudienceRegistry(): NotificationAudienceRegistry {
  const sinks: NotificationAudienceSink[] = [];
  return {
    extensionPoint: {
      registerAudienceSink: (sink) => {
        sinks.push(sink);
      },
    },
    list: () => [...sinks],
  };
}

export const notificationAudienceExtensionPoint =
  createExtensionPoint<NotificationAudienceExtensionPoint>(
    "notification.audienceExtensionPoint",
  );
