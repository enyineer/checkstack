import {
  CatalogApi,
  catalogRoutes,
  createSystemSubject,
} from "@checkstack/catalog-common";
import type { Logger } from "@checkstack/backend-api";
import type { InferClient } from "@checkstack/common";
import { resolveRoute } from "@checkstack/common";
import type { NotificationApi } from "@checkstack/notification-common";
import {
  maintenanceRoutes,
  maintenanceCollapseKey,
  maintenanceSystemSubscription,
} from "@checkstack/maintenance-common";

export async function notifyAffectedSystems(props: {
  catalogClient: InferClient<typeof CatalogApi>;
  notificationClient: InferClient<typeof NotificationApi>;
  logger: Logger;
  maintenanceId: string;
  maintenanceTitle: string;
  systemIds: string[];
  systemNames?: Map<string, string>;
  action: "created" | "updated" | "started" | "completed";
}): Promise<void> {
  const {
    notificationClient,
    logger,
    maintenanceId,
    maintenanceTitle,
    systemIds,
    systemNames,
    action,
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

  try {
    await notificationClient.notifyForSubscription({
      specId: maintenanceSystemSubscription.specId,
      resourceKeys: uniqueSystemIds,
      title: `Maintenance ${actionText}: ${maintenanceTitle}`,
      body: `Maintenance **"${maintenanceTitle}"** has been ${actionText}.`,
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
