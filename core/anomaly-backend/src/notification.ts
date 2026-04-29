import type { Logger } from "@checkstack/backend-api";
import type { CatalogApi } from "@checkstack/catalog-common";
import { catalogRoutes } from "@checkstack/catalog-common";
import type { InferClient } from "@checkstack/common";
import { resolveRoute } from "@checkstack/common";

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
  logger: Logger;
  /** Drift-specific: projected change over the baseline window. */
  projectedChange?: number;
}

/**
 * Dispatches anomaly-related notifications following the Sidecar Notification
 * Orchestration pattern. Centralizes system lookup, URL resolution, importance
 * mapping, and error isolation across all anomaly action types (Phase 1 spike
 * confirmed/recovered + Phase 2 drift confirmed/recovered).
 */
export async function dispatchAnomalyNotification({
  action,
  systemId,
  fieldPath,
  observedValue,
  baselineMean,
  catalogClient,
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

    await catalogClient.notifySystemSubscribers({
      systemId,
      title,
      body: message,
      importance,
      action: { label: "View System", url: actionUrl },
      includeGroupSubscribers: true,
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
      const projectionFragment = driftStr === ""
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

/**
 * Action-Based Importance Logic per Sidecar Orchestration standard.
 * - Terminal "Good News" states (recovered, drift_recovered) are always info.
 * - "Bad News" states (confirmed, drift_confirmed) are warnings.
 */
export function getImportance(action: AnomalyNotificationAction): "info" | "warning" {
  if (action === "recovered" || action === "drift_recovered") return "info";
  return "warning";
}
