import { implement, ORPCError } from "@orpc/server";
import {
  incidentContract,
  INCIDENT_UPDATED,
} from "@checkstack/incident-common";
import {
  autoAuthMiddleware,
  Logger,
  type RpcContext,
} from "@checkstack/backend-api";
import type { SignalService } from "@checkstack/signal-common";
import type { IncidentService } from "./service";
import { CatalogApi } from "@checkstack/catalog-common";
import { AuthApi } from "@checkstack/auth-common";
import type { InferClient } from "@checkstack/common";
import { incidentHooks } from "./hooks";
import { notifyAffectedSystems } from "./notifications";
import type { IncidentUpdate } from "@checkstack/incident-common";

export function createRouter(
  service: IncidentService,
  signalService: SignalService,
  catalogClient: InferClient<typeof CatalogApi>,
  authClient: InferClient<typeof AuthApi>,
  logger: Logger,
) {
  /**
   * Resolve user IDs to profile names for a list of updates.
   * Falls back to "Unknown User" if the user cannot be found.
   */
  async function resolveUserNames(
    updates: IncidentUpdate[],
  ): Promise<IncidentUpdate[]> {
    const userIds = [
      ...new Set(updates.map((u) => u.createdBy).filter(Boolean)),
    ];
    if (userIds.length === 0) return updates;

    const userMap = new Map<string, string>();
    await Promise.all(
      userIds.map(async (userId) => {
        try {
          const user = await authClient.getUserById({ userId: userId! });
          if (user?.name) {
            userMap.set(userId!, user.name);
          }
        } catch {
          // User not found, skip
        }
      }),
    );

    return updates.map((update) => ({
      ...update,
      createdByName: update.createdBy
        ? (userMap.get(update.createdBy) ?? undefined)
        : undefined,
    }));
  }

  /**
   * Fetch system names for a list of system IDs.
   */
  async function resolveSystemNames(
    systemIds: string[],
  ): Promise<Map<string, string>> {
    const systemNames = new Map<string, string>();
    if (systemIds.length === 0) return systemNames;

    await Promise.all(
      [...new Set(systemIds)].map(async (systemId) => {
        try {
          const system = await catalogClient.getSystem({ systemId });
          if (system?.name) {
            systemNames.set(systemId, system.name);
          }
        } catch {
          // System not found, skip
        }
      }),
    );
    return systemNames;
  }

  const os = implement(incidentContract)
    .$context<RpcContext>()
    .use(autoAuthMiddleware);

  return os.router({
    listIncidents: os.listIncidents.handler(async ({ input }) => {
      return { incidents: await service.listIncidents(input ?? {}) };
    }),

    getIncident: os.getIncident.handler(async ({ input }) => {
      const result = await service.getIncident(input.id);
      if (!result) {
        // eslint-disable-next-line unicorn/no-null -- oRPC contract requires null for missing values
        return null;
      }
      // Resolve user names for updates
      const updatesWithNames = await resolveUserNames(result.updates);
      return { ...result, updates: updatesWithNames };
    }),

    getIncidentsForSystem: os.getIncidentsForSystem.handler(
      async ({ input }) => {
        return service.getIncidentsForSystem(input.systemId);
      },
    ),

    getBulkIncidentsForSystems: os.getBulkIncidentsForSystems.handler(
      async ({ input }) => {
        const incidents: Record<
          string,
          Awaited<ReturnType<typeof service.getIncidentsForSystem>>
        > = {};

        // Fetch incidents for each system in parallel
        await Promise.all(
          input.systemIds.map(async (systemId) => {
            incidents[systemId] = await service.getIncidentsForSystem(systemId);
          }),
        );

        return { incidents };
      },
    ),

    createIncident: os.createIncident.handler(async ({ input, context }) => {
      const userId =
        context.user && "id" in context.user ? context.user.id : undefined;
      const result = await service.createIncident(input, userId);

      // Broadcast signal for realtime updates
      await signalService.broadcast(INCIDENT_UPDATED, {
        incidentId: result.id,
        systemIds: result.systemIds,
        action: "created",
      });

      // Emit hook for cross-plugin coordination
      await context.emitHook(incidentHooks.incidentCreated, {
        incidentId: result.id,
        systemIds: result.systemIds,
        title: result.title,
        description: result.description,
        severity: result.severity,
        status: result.status,
        createdAt: result.createdAt.toISOString(),
      });

      // Send notifications to system subscribers
      const systemNames = await resolveSystemNames(result.systemIds);
      await notifyAffectedSystems({
        catalogClient,
        logger,
        incidentId: result.id,
        incidentTitle: result.title,
        systemIds: result.systemIds,
        systemNames,
        action: "created",
        severity: result.severity,
      });

      return result;
    }),

    updateIncident: os.updateIncident.handler(async ({ input, context }) => {
      const result = await service.updateIncident(input);
      if (!result) {
        throw new ORPCError("NOT_FOUND", { message: "Incident not found" });
      }

      // Broadcast signal for realtime updates
      await signalService.broadcast(INCIDENT_UPDATED, {
        incidentId: result.id,
        systemIds: result.systemIds,
        action: "updated",
      });

      // Emit hook for cross-plugin coordination
      await context.emitHook(incidentHooks.incidentUpdated, {
        incidentId: result.id,
        systemIds: result.systemIds,
        title: result.title,
        description: result.description,
        severity: result.severity,
        status: result.status,
      });

      // Send notifications to system subscribers
      const systemNames = await resolveSystemNames(result.systemIds);
      await notifyAffectedSystems({
        catalogClient,
        logger,
        incidentId: result.id,
        incidentTitle: result.title,
        systemIds: result.systemIds,
        systemNames,
        action: "updated",
        severity: result.severity,
      });

      return result;
    }),

    addUpdate: os.addUpdate.handler(async ({ input, context }) => {
      const userId =
        context.user && "id" in context.user ? context.user.id : undefined;

      // Get previous status before update for reopening detection
      const previousIncident = input.statusChange
        ? await service.getIncident(input.incidentId)
        : undefined;
      const previousStatus = previousIncident?.status;

      const result = await service.addUpdate(input, userId);

      // Get incident to broadcast with correct systemIds
      const incident = await service.getIncident(input.incidentId);
      if (incident) {
        await signalService.broadcast(INCIDENT_UPDATED, {
          incidentId: input.incidentId,
          systemIds: incident.systemIds,
          action: "updated",
        });

        // Emit hook for cross-plugin coordination
        await context.emitHook(incidentHooks.incidentUpdated, {
          incidentId: input.incidentId,
          systemIds: incident.systemIds,
          title: incident.title,
          description: incident.description,
          severity: incident.severity,
          status: incident.status,
          statusChange: input.statusChange,
        });

        // If status changed to resolved, emit resolved hook
        if (input.statusChange === "resolved") {
          await context.emitHook(incidentHooks.incidentResolved, {
            incidentId: input.incidentId,
            systemIds: incident.systemIds,
            title: incident.title,
            severity: incident.severity,
            resolvedAt: new Date().toISOString(),
          });
        }

        // Send notifications when status changes
        if (input.statusChange && previousStatus !== input.statusChange) {
          // Determine notification action based on status transition
          let notificationAction: "resolved" | "reopened" | "updated";
          if (input.statusChange === "resolved") {
            notificationAction = "resolved";
          } else if (previousStatus === "resolved") {
            // Reopening: was resolved, now not resolved
            notificationAction = "reopened";
          } else {
            notificationAction = "updated";
          }

          const systemNames = await resolveSystemNames(incident.systemIds);
          await notifyAffectedSystems({
            catalogClient,
            logger,
            incidentId: input.incidentId,
            incidentTitle: incident.title,
            systemIds: incident.systemIds,
            systemNames,
            action: notificationAction,
            severity: incident.severity,
          });
        }
      }

      return result;
    }),

    resolveIncident: os.resolveIncident.handler(async ({ input, context }) => {
      const userId =
        context.user && "id" in context.user ? context.user.id : undefined;
      const result = await service.resolveIncident(
        input.id,
        input.message,
        userId,
      );
      if (!result) {
        throw new ORPCError("NOT_FOUND", { message: "Incident not found" });
      }

      // Broadcast signal for realtime updates
      await signalService.broadcast(INCIDENT_UPDATED, {
        incidentId: result.id,
        systemIds: result.systemIds,
        action: "resolved",
      });

      // Emit hook for cross-plugin coordination
      await context.emitHook(incidentHooks.incidentResolved, {
        incidentId: result.id,
        systemIds: result.systemIds,
        title: result.title,
        severity: result.severity,
        resolvedAt: new Date().toISOString(),
      });

      // Send notifications to system subscribers
      const systemNames = await resolveSystemNames(result.systemIds);
      await notifyAffectedSystems({
        catalogClient,
        logger,
        incidentId: result.id,
        incidentTitle: result.title,
        systemIds: result.systemIds,
        systemNames,
        action: "resolved",
        severity: result.severity,
      });

      return result;
    }),

    deleteIncident: os.deleteIncident.handler(async ({ input }) => {
      // Get incident before deleting to get systemIds
      const incident = await service.getIncident(input.id);
      const success = await service.deleteIncident(input.id);
      if (success && incident) {
        await signalService.broadcast(INCIDENT_UPDATED, {
          incidentId: input.id,
          systemIds: incident.systemIds,
          action: "deleted",
        });
      }
      return { success };
    }),

    hasActiveIncidentWithSuppression:
      os.hasActiveIncidentWithSuppression.handler(async ({ input }) => {
        const suppressed = await service.hasActiveIncidentWithSuppression(
          input.systemId,
        );
        return { suppressed };
      }),
  });
}
