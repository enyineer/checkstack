import { implement, ORPCError } from "@orpc/server";
import {
  incidentContract,
  INCIDENT_UPDATED,
  incidentRoutes,
} from "@checkmate-monitor/incident-common";
import {
  autoAuthMiddleware,
  Logger,
  type RpcContext,
} from "@checkmate-monitor/backend-api";
import type { SignalService } from "@checkmate-monitor/signal-common";
import type { IncidentService } from "./service";
import { CatalogApi } from "@checkmate-monitor/catalog-common";
import type { InferClient } from "@checkmate-monitor/common";
import { resolveRoute } from "@checkmate-monitor/common";
import { incidentHooks } from "./hooks";

export function createRouter(
  service: IncidentService,
  signalService: SignalService,
  catalogClient: InferClient<typeof CatalogApi>,
  logger: Logger
) {
  const os = implement(incidentContract)
    .$context<RpcContext>()
    .use(autoAuthMiddleware);

  /**
   * Helper to notify subscribers of affected systems about an incident event.
   * Each system triggers a separate notification call, but within each call
   * the subscribers are deduplicated (system + its groups).
   */
  const notifyAffectedSystems = async (props: {
    incidentId: string;
    incidentTitle: string;
    systemIds: string[];
    action: "created" | "updated" | "resolved";
    severity: string;
  }) => {
    const { incidentId, incidentTitle, systemIds, action, severity } = props;

    const actionText =
      action === "created"
        ? "reported"
        : action === "resolved"
        ? "resolved"
        : "updated";

    const importance =
      severity === "critical"
        ? "critical"
        : severity === "major"
        ? "warning"
        : "info";

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
          importance: importance as "info" | "warning" | "critical",
          action: { label: "View Incident", url: incidentDetailPath },
          includeGroupSubscribers: true,
        });
      } catch (error) {
        // Log but don't fail the operation - notifications are best-effort
        logger.warn(
          `Failed to notify subscribers for system ${systemId}:`,
          error
        );
      }
    }
  };

  return os.router({
    listIncidents: os.listIncidents.handler(async ({ input }) => {
      return service.listIncidents(input ?? {});
    }),

    getIncident: os.getIncident.handler(async ({ input }) => {
      const result = await service.getIncident(input.id);
      // eslint-disable-next-line unicorn/no-null -- oRPC contract requires null for missing values
      return result ?? null;
    }),

    getIncidentsForSystem: os.getIncidentsForSystem.handler(
      async ({ input }) => {
        return service.getIncidentsForSystem(input.systemId);
      }
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
      await notifyAffectedSystems({
        incidentId: result.id,
        incidentTitle: result.title,
        systemIds: result.systemIds,
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
      await notifyAffectedSystems({
        incidentId: result.id,
        incidentTitle: result.title,
        systemIds: result.systemIds,
        action: "updated",
        severity: result.severity,
      });

      return result;
    }),

    addUpdate: os.addUpdate.handler(async ({ input, context }) => {
      const userId =
        context.user && "id" in context.user ? context.user.id : undefined;
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
      }

      return result;
    }),

    resolveIncident: os.resolveIncident.handler(async ({ input, context }) => {
      const userId =
        context.user && "id" in context.user ? context.user.id : undefined;
      const result = await service.resolveIncident(
        input.id,
        input.message,
        userId
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
      await notifyAffectedSystems({
        incidentId: result.id,
        incidentTitle: result.title,
        systemIds: result.systemIds,
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
  });
}
