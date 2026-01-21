import { CatalogApi } from "@checkstack/catalog-common";
import type { Logger } from "@checkstack/backend-api";
import type { InferClient } from "@checkstack/common";
import { resolveRoute } from "@checkstack/common";
import { incidentRoutes } from "@checkstack/incident-common";

/**
 * Determines notification importance based on action and severity.
 * Resolved actions are always "info" (good news).
 * Other actions derive importance from severity.
 */
function getImportance(
  action: "created" | "updated" | "resolved" | "reopened",
  severity: string,
): "info" | "warning" | "critical" {
  // Resolved is always good news
  if (action === "resolved") {
    return "info";
  }

  // For other actions, derive from severity
  if (severity === "critical") {
    return "critical";
  }
  if (severity === "major") {
    return "warning";
  }
  return "info";
}

/**
 * Helper to notify subscribers of affected systems about an incident event.
 * Each system triggers a separate notification call, but within each call
 * the subscribers are deduplicated (system + its groups).
 */
export async function notifyAffectedSystems(props: {
  catalogClient: InferClient<typeof CatalogApi>;
  logger: Logger;
  incidentId: string;
  incidentTitle: string;
  systemIds: string[];
  action: "created" | "updated" | "resolved" | "reopened";
  severity: string;
}): Promise<void> {
  const {
    catalogClient,
    logger,
    incidentId,
    incidentTitle,
    systemIds,
    action,
    severity,
  } = props;

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

  // Deduplicate: collect unique system IDs
  const uniqueSystemIds = [...new Set(systemIds)];

  for (const systemId of uniqueSystemIds) {
    try {
      await catalogClient.notifySystemSubscribers({
        systemId,
        title: `Incident ${actionText}`,
        body: `Incident **"${incidentTitle}"** has been ${actionText} for a system you're subscribed to.`,
        importance,
        action: { label: "View Incident", url: incidentDetailPath },
        includeGroupSubscribers: true,
      });
    } catch (error) {
      // Log but don't fail the operation - notifications are best-effort
      logger.warn(
        `Failed to notify subscribers for system ${systemId}:`,
        error,
      );
    }
  }
}
