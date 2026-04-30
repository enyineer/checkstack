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
  incidentRoutes,
  incidentCollapseKey,
  incidentSystemSubscription,
} from "@checkstack/incident-common";

/**
 * Send a single notification to every subscriber across the affected
 * systems and their parent catalog groups. Inheritance and dedup are
 * handled inside notification-backend — incident only supplies the
 * resource keys (system ids) and the payload.
 */
export async function notifyAffectedSystems(props: {
  catalogClient: InferClient<typeof CatalogApi>;
  notificationClient: InferClient<typeof NotificationApi>;
  logger: Logger;
  incidentId: string;
  incidentTitle: string;
  systemIds: string[];
  systemNames?: Map<string, string>;
  action: "created" | "updated" | "resolved" | "reopened";
  severity: string;
}): Promise<void> {
  const {
    notificationClient,
    logger,
    incidentId,
    incidentTitle,
    systemIds,
    systemNames,
    action,
    severity,
  } = props;
  void props.catalogClient;

  const uniqueSystemIds = [...new Set(systemIds)];
  if (uniqueSystemIds.length === 0) return;

  const actionText = {
    created: "reported",
    updated: "updated",
    resolved: "resolved",
    reopened: "reopened",
  }[action];

  const importance = getImportance(action, severity);
  const incidentDetailPath = resolveRoute(incidentRoutes.routes.detail, {
    incidentId,
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
      specId: incidentSystemSubscription.specId,
      resourceKeys: uniqueSystemIds,
      title: `Incident ${actionText}: ${incidentTitle}`,
      body: `Incident **"${incidentTitle}"** has been ${actionText}.`,
      importance,
      action: { label: "View Incident", url: incidentDetailPath },
      collapseKey: incidentCollapseKey(incidentId),
      subjects,
    });
  } catch (error) {
    logger.warn(
      `Failed to notify subscribers for incident ${incidentId}:`,
      error,
    );
  }
}

function getImportance(
  action: "created" | "updated" | "resolved" | "reopened",
  severity: string,
): "info" | "warning" | "critical" {
  if (action === "resolved") return "info";
  if (severity === "critical") return "critical";
  if (severity === "major") return "warning";
  return "info";
}
