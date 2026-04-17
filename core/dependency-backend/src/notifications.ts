import type { Logger } from "@checkstack/backend-api";
import type { InferClient } from "@checkstack/common";
import { resolveRoute } from "@checkstack/common";
import type { CatalogApi } from "@checkstack/catalog-common";
import { catalogRoutes } from "@checkstack/catalog-common";
import type { MaintenanceApi } from "@checkstack/maintenance-common";
import type { IncidentApi } from "@checkstack/incident-common";
import type { DerivedState } from "@checkstack/dependency-common";
import type { DependencyService } from "./services/dependency-service";
import type {
  WarningEvaluationService,
  SystemStatus,
} from "./services/warning-evaluation-service";
import type { SafeDatabase } from "@checkstack/backend-api";
import * as schema from "./schema";
import { dependencyDerivedStates } from "./schema";
import { eq } from "drizzle-orm";

type Db = SafeDatabase<typeof schema>;

/**
 * Map derived state to notification importance.
 */
function derivedStateToImportance(
  derivedState: DerivedState,
): "info" | "warning" | "critical" {
  switch (derivedState) {
    case "info": {
      return "info";
    }
    case "degraded": {
      return "warning";
    }
    case "down": {
      return "critical";
    }
  }
}

/**
 * Generate notification title for a dependency-driven state change.
 */
export function buildNotificationTitle({
  derivedState,
  isRecovery,
}: {
  derivedState?: DerivedState;
  isRecovery: boolean;
}): string {
  if (isRecovery) {
    return "Dependency impact resolved";
  }

  switch (derivedState) {
    case "info": {
      return "Upstream dependency issue (informational)";
    }
    case "degraded": {
      return "Availability impacted by upstream dependency";
    }
    case "down": {
      return "Availability critically impacted by upstream dependency";
    }
    default: {
      return "Dependency impact changed";
    }
  }
}

/**
 * Generate notification body for a dependency-driven state change.
 */
export function buildNotificationBody({
  upstreamNames,
  derivedState,
  isRecovery,
}: {
  upstreamNames: string[];
  derivedState?: DerivedState;
  isRecovery: boolean;
}): string {
  const upstreamList = upstreamNames.join(", ");

  if (isRecovery) {
    return "All upstream dependencies have recovered. This system is no longer affected by dependency failures.";
  }

  switch (derivedState) {
    case "info": {
      return `An upstream dependency (${upstreamList}) is experiencing issues. This is informational — no direct impact expected.`;
    }
    case "degraded": {
      return `An upstream dependency (${upstreamList}) is experiencing issues. This system's availability may be degraded.`;
    }
    case "down": {
      return `A critical upstream dependency (${upstreamList}) is down. This system is expected to be unavailable.`;
    }
    default: {
      return `Upstream dependency status has changed (${upstreamList}).`;
    }
  }
}

/**
 * Evaluate downstream systems for dependency-driven state changes
 * and notify subscribers when the derived state transitions.
 *
 * This is the Sidecar Notification Orchestration function.
 * It runs when an upstream system's health status changes.
 */
export async function evaluateAndNotifyDownstream({
  changedSystemId,
  db,
  dependencyService,
  warningService,
  fetchSystemStatuses,
  catalogClient,
  maintenanceClient,
  incidentClient,
  logger,
}: {
  changedSystemId: string;
  db: Db;
  dependencyService: DependencyService;
  warningService: WarningEvaluationService;
  fetchSystemStatuses: (
    systemIds: string[],
  ) => Promise<Map<string, SystemStatus>>;
  catalogClient: InferClient<typeof CatalogApi>;
  maintenanceClient: InferClient<typeof MaintenanceApi>;
  incidentClient: InferClient<typeof IncidentApi>;
  logger: Logger;
}): Promise<void> {
  try {
    // 1. Find all downstream systems that depend on the changed system
    const allDeps = await dependencyService.getAllDependencies();
    const downstreamSystemIds = new Set<string>();

    for (const dep of allDeps) {
      if (dep.targetSystemId === changedSystemId) {
        downstreamSystemIds.add(dep.sourceSystemId);
      }
    }

    // Also check transitive downstream systems (systems that depend on
    // systems that depend on the changed system, etc.)
    const visited = new Set<string>();
    const queue = [...downstreamSystemIds];
    while (queue.length > 0) {
      const systemId = queue.pop()!;
      if (visited.has(systemId)) continue;
      visited.add(systemId);
      downstreamSystemIds.add(systemId);

      // Find systems that depend on this system transitively
      for (const dep of allDeps) {
        if (
          dep.targetSystemId === systemId &&
          dep.transitive &&
          !visited.has(dep.sourceSystemId)
        ) {
          queue.push(dep.sourceSystemId);
        }
      }
    }

    if (downstreamSystemIds.size === 0) {
      return;
    }

    const downstreamIds = [...downstreamSystemIds];

    // 2. Fetch all system IDs needed for evaluation
    const allSystemIds = new Set<string>(downstreamIds);
    for (const dep of allDeps) {
      allSystemIds.add(dep.sourceSystemId);
      allSystemIds.add(dep.targetSystemId);
    }

    const statuses = await fetchSystemStatuses([...allSystemIds]);

    // 3. Evaluate current warnings for all downstream systems
    const warningMap = warningService.evaluateWarnings({
      systemIds: downstreamIds,
      allDependencies: allDeps,
      systemStatuses: statuses,
    });

    // 4. Load previous derived states from DB
    const previousStates = await db
      .select()
      .from(dependencyDerivedStates)
      .then((rows) => rows)
      .catch(() => []);

    // Build lookup from existing records — filter to relevant systems only
    const previousStateMap = new Map<string, DerivedState>();
    for (const row of previousStates) {
      if (downstreamSystemIds.has(row.systemId)) {
        previousStateMap.set(row.systemId, row.derivedState as DerivedState);
      }
    }

    // 5. Check maintenance suppression on the upstream system that changed
    let upstreamSuppressed = false;
    try {
      const { suppressed } =
        await maintenanceClient.hasActiveMaintenanceWithSuppression({
          systemId: changedSystemId,
        });
      upstreamSuppressed = suppressed;
    } catch (error) {
      logger.warn(
        `Failed to check maintenance suppression for upstream ${changedSystemId}:`,
        error,
      );
    }

    // Also check incident suppression on the upstream
    if (!upstreamSuppressed) {
      try {
        const { suppressed } =
          await incidentClient.hasActiveIncidentWithSuppression({
            systemId: changedSystemId,
          });
        upstreamSuppressed = suppressed;
      } catch (error) {
        logger.warn(
          `Failed to check incident suppression for upstream ${changedSystemId}:`,
          error,
        );
      }
    }

    // 6. Compare and notify for each downstream system
    for (const systemId of downstreamIds) {
      const currentWarning = warningMap.get(systemId);
      const currentState = currentWarning?.derivedState;
      const previousState = previousStateMap.get(systemId);

      // No change — skip
      if (currentState === previousState) {
        continue;
      }

      // State changed — update DB first
      await (currentState
        ? db
            .insert(dependencyDerivedStates)
            .values({
              systemId,
              derivedState: currentState,
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: dependencyDerivedStates.systemId,
              set: {
                derivedState: currentState,
                updatedAt: new Date(),
              },
            })
        : db
            .delete(dependencyDerivedStates)
            .where(eq(dependencyDerivedStates.systemId, systemId)));

      // Skip notifications if upstream is suppressed
      if (upstreamSuppressed) {
        logger.debug(
          `Skipping dependency notification for ${systemId}: upstream ${changedSystemId} has suppression enabled`,
        );
        continue;
      }

      // Build notification
      const isRecovery = !currentState && !!previousState;
      const upstreamNames =
        currentWarning?.affectedUpstreams.map(
          (u) => u.systemName ?? u.systemId,
        ) ?? [];

      const title = buildNotificationTitle({
        derivedState: currentState,
        isRecovery,
      });
      const body = buildNotificationBody({
        upstreamNames,
        derivedState: currentState,
        isRecovery,
      });
      const importance = isRecovery
        ? ("info" as const)
        : derivedStateToImportance(currentState!);

      const systemDetailPath = resolveRoute(
        catalogRoutes.routes.systemDetail,
        { systemId },
      );

      try {
        await catalogClient.notifySystemSubscribers({
          systemId,
          title,
          body,
          importance,
          action: { label: "View System", url: systemDetailPath },
          includeGroupSubscribers: true,
        });
        logger.debug(
          `Dependency notification sent: ${systemId} ${previousState ?? "none"} → ${currentState ?? "none"}`,
        );
      } catch (error) {
        // Notifications are best-effort
        logger.warn(
          `Failed to send dependency notification for ${systemId}:`,
          error,
        );
      }
    }
  } catch (error) {
    // Don't crash the hook handler
    logger.error(
      `Failed to evaluate dependency notifications for upstream ${changedSystemId}:`,
      error,
    );
  }
}
