import { CatalogApi } from "@checkstack/catalog-common";
import type { Logger } from "@checkstack/backend-api";
import type { InferClient } from "@checkstack/common";
import { resolveRoute } from "@checkstack/common";
import { maintenanceRoutes } from "@checkstack/maintenance-common";

/**
 * Helper to notify subscribers of affected systems about a maintenance event.
 * Each system triggers a separate notification call, but within each call
 * the subscribers are deduplicated (system + its groups).
 */
export async function notifyAffectedSystems(props: {
  catalogClient: InferClient<typeof CatalogApi>;
  logger: Logger;
  maintenanceId: string;
  maintenanceTitle: string;
  systemIds: string[];
  systemNames?: Map<string, string>;
  action: "created" | "updated" | "started" | "completed";
}): Promise<void> {
  const {
    catalogClient,
    logger,
    maintenanceId,
    maintenanceTitle,
    systemIds,
    systemNames,
    action,
  } = props;

  const actionText = {
    created: "scheduled",
    updated: "updated",
    started: "started",
    completed: "completed",
  }[action];

  const maintenanceDetailPath = resolveRoute(maintenanceRoutes.routes.detail, {
    maintenanceId,
  });

  for (const systemId of systemIds) {
    // Resolve system name from provided map, or fall back to systemId
    const systemName = systemNames?.get(systemId) ?? systemId;

    try {
      await catalogClient.notifySystemSubscribers({
        systemId,
        title: `Maintenance ${actionText}: ${systemName}`,
        body: `Maintenance **"${maintenanceTitle}"** has been ${actionText} for **${systemName}**.`,
        importance: "info",
        action: { label: "View Maintenance", url: maintenanceDetailPath },
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

