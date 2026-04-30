import type { Logger, SafeDatabase } from "@checkstack/backend-api";
import type { CatalogApi } from "@checkstack/catalog-common";
import { catalogRoutes, createSystemSubject } from "@checkstack/catalog-common";
import type { InferClient } from "@checkstack/common";
import { resolveRoute } from "@checkstack/common";
import {
  anomalyCollapseKey,
  anomalySystemSubscription,
} from "@checkstack/anomaly-common";
import type { NotificationApi } from "@checkstack/notification-common";
import { AnomalyService } from "./service";
import * as schema from "./schema";

export type AnomalyNotificationAction =
  | "confirmed"
  | "recovered"
  | "drift_confirmed"
  | "drift_recovered";

export interface DispatchAnomalyNotificationInput {
  action: AnomalyNotificationAction;
  systemId: string;
  fieldPath: string;
  observedValue: string | boolean | number;
  baselineMean: number;
  catalogClient: InferClient<typeof CatalogApi>;
  notificationClient: InferClient<typeof NotificationApi>;
  db: SafeDatabase<typeof schema>;
  logger: Logger;
  /** Drift-specific: projected change over the baseline window. */
  projectedChange?: number;
}

/**
 * Dispatches anomaly notifications via the platform spec contract.
 * Notification-backend resolves the spec → groupId convention, walks
 * parent catalog groups via stored target edges, and unions
 * subscribers. Anomaly only contributes the recipient-exclusion list
 * (per-field / per-system mutes) before delivery.
 */
export async function dispatchAnomalyNotification({
  action,
  systemId,
  fieldPath,
  observedValue,
  baselineMean,
  catalogClient,
  notificationClient,
  db,
  logger,
  projectedChange,
}: DispatchAnomalyNotificationInput): Promise<void> {
  try {
    const system = await catalogClient.getSystem({ systemId });
    const systemName = system?.name ?? systemId;
    const actionUrl = resolveRoute(catalogRoutes.routes.systemDetail, {
      systemId,
    });

    const obsStr =
      typeof observedValue === "number"
        ? observedValue.toFixed(2)
        : String(observedValue);
    const baseStr = baselineMean.toFixed(2);
    const driftStr =
      projectedChange === undefined
        ? ""
        : `${projectedChange >= 0 ? "+" : ""}${projectedChange.toFixed(2)}`;

    const { title, message } = buildNotificationCopy({
      action,
      systemName,
      fieldPath,
      obsStr,
      baseStr,
      driftStr,
    });

    const importance = getImportance(action);

    // Mute exclusions are computed against the candidate set the
    // dispatcher will produce — for that we need to know who *would*
    // be reached. Ask the AnomalyService for everyone muted on this
    // (system, fieldPath) regardless of subscription state; backend
    // does the intersection during dispatch (subscribers ∩ excluded).
    const service = new AnomalyService(db);
    const mutedUserIds = await service.getMutedUserIds({
      systemId,
      fieldPath,
    });

    await notificationClient.notifyForSubscription({
      specId: anomalySystemSubscription.specId,
      resourceKeys: [systemId],
      excludeUserIds: [...mutedUserIds],
      title,
      body: message,
      importance,
      action: { label: "View System", url: actionUrl },
      collapseKey: anomalyCollapseKey(systemId, fieldPath),
      subjects: [
        createSystemSubject({
          id: systemId,
          name: systemName,
          url: actionUrl,
        }),
      ],
    });
  } catch (error) {
    logger.warn(
      `Failed to dispatch anomaly ${action} notification for ${systemId}`,
      error,
    );
  }
}

function buildNotificationCopy({
  action,
  systemName,
  fieldPath,
  obsStr,
  baseStr,
  driftStr,
}: {
  action: AnomalyNotificationAction;
  systemName: string;
  fieldPath: string;
  obsStr: string;
  baseStr: string;
  driftStr: string;
}): { title: string; message: string } {
  switch (action) {
    case "confirmed": {
      return {
        title: `Anomaly Detected: ${systemName}`,
        message: `Anomaly confirmed for **${fieldPath}**. Observed: ${obsStr}, Baseline: ${baseStr}.`,
      };
    }
    case "recovered": {
      return {
        title: `Anomaly Recovered: ${systemName}`,
        message: `Anomaly recovered for **${fieldPath}**. Observed: ${obsStr}, Baseline: ${baseStr}.`,
      };
    }
    case "drift_confirmed": {
      const projectionFragment =
        driftStr === ""
          ? ""
          : ` Projected change over the baseline window: ${driftStr}.`;
      return {
        title: `Trend Drift Detected: ${systemName}`,
        message: `**${fieldPath}** is drifting. Current mean: ${obsStr}, Baseline: ${baseStr}.${projectionFragment}`,
      };
    }
    case "drift_recovered": {
      return {
        title: `Trend Drift Recovered: ${systemName}`,
        message: `**${fieldPath}** has stabilized. Current mean: ${obsStr}, Baseline: ${baseStr}.`,
      };
    }
  }
}

export function getImportance(
  action: AnomalyNotificationAction,
): "info" | "warning" {
  if (action === "recovered" || action === "drift_recovered") return "info";
  return "warning";
}
