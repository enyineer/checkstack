import {
  CatalogApi,
  catalogRoutes,
  createSystemSubject,
} from "@checkstack/catalog-common";
import type { Logger } from "@checkstack/backend-api";
import type { InferClient } from "@checkstack/common";
import { resolveRoute } from "@checkstack/common";
import type { NotificationApi } from "@checkstack/notification-common";
import { buildUpdateMessageSuffix } from "@checkstack/notification-common";
import {
  maintenanceRoutes,
  maintenanceCollapseKey,
  maintenanceSystemSubscription,
} from "@checkstack/maintenance-common";
import { buildMaintenanceNotificationBody } from "./notification-body";

export async function notifyAffectedSystems(props: {
  catalogClient: InferClient<typeof CatalogApi>;
  notificationClient: InferClient<typeof NotificationApi>;
  logger: Logger;
  maintenanceId: string;
  maintenanceTitle: string;
  systemIds: string[];
  systemNames?: Map<string, string>;
  action: "created" | "updated" | "started" | "completed";
  /**
   * The maintenance's own description - what is planned. Included so a
   * subscriber learns the substance from the notification instead of having to
   * open the app. User-supplied markdown, sanitized before it reaches the body.
   */
  description?: string | null;
  /** Scheduled window start, rendered in the body as UTC. */
  startAt?: Date | string | null;
  /** Scheduled window end, rendered in the body as UTC. */
  endAt?: Date | string | null;
  /**
   * The latest maintenance update's free-text message. When present it is
   * escaped, single-lined, truncated, and appended to the notification body as
   * a blockquote so subscribers see WHAT changed, not just that something did.
   * User-supplied, so it is always sanitized before it reaches a markdown body.
   */
  updateMessage?: string;
}): Promise<void> {
  const {
    notificationClient,
    logger,
    maintenanceId,
    maintenanceTitle,
    systemIds,
    systemNames,
    action,
    description,
    startAt,
    endAt,
    updateMessage,
  } = props;
  void props.catalogClient;

  const uniqueSystemIds = [...new Set(systemIds)];
  if (uniqueSystemIds.length === 0) return;

  const actionText = {
    created: "scheduled",
    updated: "updated",
    started: "started",
    completed: "completed",
  }[action];

  const maintenanceDetailPath = resolveRoute(maintenanceRoutes.routes.detail, {
    maintenanceId,
  });
  const subjects = uniqueSystemIds.map((systemId) =>
    createSystemSubject({
      id: systemId,
      name: systemNames?.get(systemId) ?? systemId,
      url: resolveRoute(catalogRoutes.routes.systemDetail, { systemId }),
    }),
  );

  const messageSuffix = buildUpdateMessageSuffix({ message: updateMessage });

  try {
    await notificationClient.notifyForSubscription({
      specId: maintenanceSystemSubscription.specId,
      resourceKeys: uniqueSystemIds,
      title: `Maintenance ${actionText}: ${maintenanceTitle}`,
      body: buildMaintenanceNotificationBody({
        maintenanceTitle,
        actionText,
        description,
        startAt,
        endAt,
        updateMessageSuffix: messageSuffix,
      }),
      importance: "info",
      action: { label: "View Maintenance", url: maintenanceDetailPath },
      collapseKey: maintenanceCollapseKey(maintenanceId),
      subjects,
    });
  } catch (error) {
    logger.warn(
      `Failed to notify subscribers for maintenance ${maintenanceId}:`,
      error,
    );
  }
}
