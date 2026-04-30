import type { Logger } from "@checkstack/backend-api";
import type { InferClient } from "@checkstack/common";
import { resolveRoute } from "@checkstack/common";
import type { CatalogApi } from "@checkstack/catalog-common";
import { catalogRoutes, createSystemSubject } from "@checkstack/catalog-common";
import type { MaintenanceApi } from "@checkstack/maintenance-common";
import type { IncidentApi } from "@checkstack/incident-common";
import type { NotificationApi } from "@checkstack/notification-common";
import {
  dependencyUpstreamCollapseKey,
  dependencySystemSubscription,
} from "@checkstack/dependency-common";
import type { DerivedState } from "@checkstack/dependency-common";
import { DEPENDENCY_WARNINGS_CHANGED } from "@checkstack/dependency-common";
import type { DependencyService } from "./services/dependency-service";
import type {
  WarningEvaluationService,
  SystemStatus,
} from "./services/warning-evaluation-service";
import type { SafeDatabase } from "@checkstack/backend-api";
import type { SignalService } from "@checkstack/signal-common";
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
  systemName,
}: {
  derivedState?: DerivedState;
  isRecovery: boolean;
  systemName?: string;
}): string {
  const prefix = systemName ? `${systemName}: ` : "";

  if (isRecovery) {
    return `${prefix}Dependency impact resolved`;
  }

  switch (derivedState) {
    case "info": {
      return `${prefix}Upstream dependency issue (informational)`;
    }
    case "degraded": {
      return `${prefix}Availability impacted by upstream dependency`;
    }
    case "down": {
      return `${prefix}Availability critically impacted by upstream dependency`;
    }
    default: {
      return `${prefix}Dependency impact changed`;
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
  systemName,
}: {
  upstreamNames: string[];
  derivedState?: DerivedState;
  isRecovery: boolean;
  systemName?: string;
}): string {
  const upstreamList = upstreamNames.join(", ");
  const systemRef = systemName ? `**${systemName}**` : "This system";

  if (isRecovery) {
    return `All upstream dependencies have recovered. ${systemRef} is no longer affected by dependency failures.`;
  }

  switch (derivedState) {
    case "info": {
      return `An upstream dependency (${upstreamList}) is experiencing issues. ${systemRef} — this is informational, no direct impact expected.`;
    }
    case "degraded": {
      return `An upstream dependency (${upstreamList}) is experiencing issues. ${systemRef}'s availability may be degraded.`;
    }
    case "down": {
      return `A critical upstream dependency (${upstreamList}) is down. ${systemRef} is expected to be unavailable.`;
    }
    default: {
      return `Upstream dependency status has changed (${upstreamList}).`;
    }
  }
}

/**
 * Represents a downstream system that needs notification due to a state change.
 */
export interface SystemNotificationEntry {
  systemId: string;
  systemName: string;
  derivedState?: DerivedState;
  isRecovery: boolean;
  importance: "info" | "warning" | "critical";
  upstreamNames: string[];
}

/**
 * Resolve the worst importance level from a list of notification entries.
 */
function resolveWorstImportance(
  entries: SystemNotificationEntry[],
): "info" | "warning" | "critical" {
  let worst: "info" | "warning" | "critical" = "info";
  for (const entry of entries) {
    if (entry.importance === "critical") return "critical";
    if (entry.importance === "warning") worst = "warning";
  }
  return worst;
}

/**
 * Format a per-system impact line with criticality indicator for multi-system
 * notification bodies.
 */
export function formatSystemImpactLine(entry: SystemNotificationEntry): string {
  if (entry.isRecovery) {
    return `- ✅ **${entry.systemName}** — recovered`;
  }

  switch (entry.derivedState) {
    case "down": {
      return `- 🔴 **${entry.systemName}** — critically impacted`;
    }
    case "degraded": {
      return `- 🟡 **${entry.systemName}** — degraded`;
    }
    case "info": {
      return `- ℹ️ **${entry.systemName}** — informational`;
    }
    default: {
      return `- **${entry.systemName}** — impact changed`;
    }
  }
}

/**
 * Evaluate downstream systems for dependency-driven state changes
 * and notify subscribers when the derived state transitions.
 *
 * This is the Sidecar Notification Orchestration function.
 * It runs when an upstream system's health status changes.
 *
 * Notification deduplication: Instead of sending one notification per
 * downstream system (which floods users subscribed to groups), we resolve
 * all affected subscribers and send one personalized notification per user
 * listing only the systems they are subscribed to.
 */
export async function evaluateAndNotifyDownstream({
  changedSystemId,
  db,
  dependencyService,
  warningService,
  fetchSystemStatuses,
  catalogClient,
  notificationClient,
  maintenanceClient,
  incidentClient,
  signalService,
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
  notificationClient: InferClient<typeof NotificationApi>;
  maintenanceClient: InferClient<typeof MaintenanceApi>;
  incidentClient: InferClient<typeof IncidentApi>;
  signalService: SignalService;
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

    // 6. Evaluate state changes and collect systems that need notification
    const changedSystemIds: string[] = [];
    const systemsToNotify: SystemNotificationEntry[] = [];

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

      changedSystemIds.push(systemId);

      // Skip notifications if upstream is suppressed
      if (upstreamSuppressed) {
        logger.debug(
          `Skipping dependency notification for ${systemId}: upstream ${changedSystemId} has suppression enabled`,
        );
        continue;
      }

      // Collect notification entry instead of sending immediately
      const isRecovery = !currentState && !!previousState;
      const upstreamNames =
        currentWarning?.affectedUpstreams.map(
          (u) => u.systemName ?? u.systemId,
        ) ?? [];
      const systemName =
        statuses.get(systemId)?.systemName ?? systemId;

      systemsToNotify.push({
        systemId,
        systemName,
        derivedState: currentState,
        isRecovery,
        importance: isRecovery
          ? "info"
          : derivedStateToImportance(currentState!),
        upstreamNames,
      });
    }

    // 7. Send batched per-user notifications (deduplication)
    if (systemsToNotify.length > 0) {
      await sendBatchedNotifications({
        systemsToNotify,
        changedSystemId,
        statuses,
        catalogClient,
        notificationClient,
        logger,
      });
    }

    // 8. Broadcast signal so frontends can react
    if (changedSystemIds.length > 0) {
      await signalService.broadcast(DEPENDENCY_WARNINGS_CHANGED, {
        affectedSystemIds: changedSystemIds,
      });
    }
  } catch (error) {
    // Don't crash the hook handler
    logger.error(
      `Failed to evaluate dependency notifications for upstream ${changedSystemId}:`,
      error,
    );
  }
}

/**
 * Dispatch one notification per impacted downstream system using the
 * platform spec contract. Subscribers to each downstream system (and its
 * parent catalog groups, resolved server-side via stored target edges)
 * receive a notification describing the upstream impact. Multi-system
 * dispatches collapse on the *upstream* changedSystemId so a recipient
 * subscribed to several downstreams sees one card per upstream event,
 * not one per downstream.
 */
async function sendBatchedNotifications({
  systemsToNotify,
  changedSystemId,
  statuses,
  catalogClient,
  notificationClient,
  logger,
}: {
  systemsToNotify: SystemNotificationEntry[];
  changedSystemId: string;
  statuses: Map<string, SystemStatus>;
  catalogClient: InferClient<typeof CatalogApi>;
  notificationClient: InferClient<typeof NotificationApi>;
  logger: Logger;
}): Promise<void> {
  void catalogClient;
  if (systemsToNotify.length === 0) return;

  const upstreamName =
    statuses.get(changedSystemId)?.systemName ?? changedSystemId;
  const upstreamSystemDetailPath = resolveRoute(
    catalogRoutes.routes.systemDetail,
    { systemId: changedSystemId },
  );

  for (const entry of systemsToNotify) {
    const title = buildNotificationTitle({
      derivedState: entry.derivedState,
      isRecovery: entry.isRecovery,
      systemName: entry.systemName,
    });
    const body = buildNotificationBody({
      upstreamNames: entry.upstreamNames,
      derivedState: entry.derivedState,
      isRecovery: entry.isRecovery,
      systemName: entry.systemName,
    });
    const importance = entry.isRecovery
      ? ("info" as const)
      : resolveWorstImportance([entry]);

    try {
      await notificationClient.notifyForSubscription({
        specId: dependencySystemSubscription.specId,
        resourceKeys: [entry.systemId],
        title,
        body,
        importance,
        action: { label: "View Root Cause", url: upstreamSystemDetailPath },
        collapseKey: dependencyUpstreamCollapseKey(changedSystemId),
        subjects: [
          createSystemSubject({
            id: entry.systemId,
            name: entry.systemName,
            url: resolveRoute(catalogRoutes.routes.systemDetail, {
              systemId: entry.systemId,
            }),
          }),
        ],
      });
    } catch (error) {
      logger.warn(
        `Failed to dispatch dependency notification for ${entry.systemId}:`,
        error,
      );
    }
  }
  void upstreamName;
}

