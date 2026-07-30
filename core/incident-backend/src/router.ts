import { implement, ORPCError } from "@orpc/server";
import {
  incidentContract,
  INCIDENT_UPDATED,
} from "@checkstack/incident-common";
import {
  autoAuthMiddleware,
  correlationMiddleware,
  Logger,
  type EventBus,
  type RpcContext,
} from "@checkstack/backend-api";
import type { SignalService } from "@checkstack/signal-common";
import type { IncidentLifecycleChangedPayload } from "@checkstack/incident-common";
import { emitIncidentLifecycleChanged } from "./hooks";
import type { IncidentService } from "./service";
import { CatalogApi } from "@checkstack/catalog-common";
import { AuthApi } from "@checkstack/auth-common";
import type { InferClient } from "@checkstack/common";
import { notifyAffectedSystems } from "./notifications";
import type {
  IncidentUpdate,
  IncidentWithSystems,
  BulkIncidentActionResult,
} from "@checkstack/incident-common";
import type { IncidentCache } from "./cache";
import type { EntityHandle } from "@checkstack/automation-backend";
import {
  writeIncidentEntity,
  removeIncidentEntity,
  toIncidentEntityState,
  type IncidentEntityState,
} from "./incident-entity";
import {
  resolveIncidentAudience,
  filterByAudience,
  scopeEditHistory,
} from "./read-visibility";

export interface IncidentRouterDeps {
  service: IncidentService;
  signalService: SignalService;
  /**
   * Distributed event bus used to emit the `incident.lifecycle.changed` hook on
   * every lifecycle mutation (alongside the realtime `INCIDENT_UPDATED` signal),
   * so backend consumers (e.g. SLO downtime reconciliation) react with
   * exactly-once `work-queue` delivery. Optional so tests can omit it.
   */
  eventBus?: EventBus;
  catalogClient: InferClient<typeof CatalogApi>;
  notificationClient: InferClient<
    typeof import("@checkstack/notification-common").NotificationApi
  >;
  authClient: InferClient<typeof AuthApi>;
  logger: Logger;
  cache: IncidentCache;
  /** Resolver for the reactive `incident` entity (§10.1). Undefined in tests. */
  getIncidentEntity?: () => EntityHandle<IncidentEntityState> | undefined;
}

export function createRouter({
  service,
  signalService,
  eventBus,
  catalogClient,
  notificationClient,
  authClient,
  logger,
  cache,
  getIncidentEntity,
}: IncidentRouterDeps) {
  /**
   * Announce an incident lifecycle change: broadcast the realtime
   * `INCIDENT_UPDATED` signal (frontend refetch) AND emit the distributed
   * `incident.lifecycle.changed` hook (backend consumers, e.g. SLO downtime).
   * Kept as one call so the signal and the hook can never drift apart. Both are
   * best-effort: the write is already committed, so a delivery failure must
   * never surface as a client error (the signal is inherently non-throwing; the
   * hook emit is guarded here).
   */
  const notifyIncidentChanged = async (
    payload: IncidentLifecycleChangedPayload,
  ) => {
    await signalService.broadcast(INCIDENT_UPDATED, payload);
    await emitIncidentLifecycleChanged({ eventBus, logger, payload });
  };
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

  /**
   * Resolve a single incident and run the full post-mutation sequence
   * (entity write → cache invalidate → signal → notify). Returns `"notFound"`
   * for a missing incident WITHOUT throwing, so the single-item handler (which
   * turns that into a 404) and the bulk handler (which records it as a per-id
   * outcome) share one code path.
   */
  async function resolveOneIncident({
    id,
    message,
    userId,
  }: {
    id: string;
    message?: string;
    userId?: string;
  }): Promise<{
    status: "resolved" | "notFound";
    incident?: IncidentWithSystems;
  }> {
    const existing = await service.getIncident(id);
    if (!existing) return { status: "notFound" };

    let resolved: IncidentWithSystems | undefined;
    await writeIncidentEntity({
      handle: getIncidentEntity?.(),
      incidentId: id,
      apply: async () => {
        resolved = await service.resolveIncident(id, message, userId);
        // A race could delete the incident between probe and write; fall back
        // to the pre-write snapshot so the entity diff is a no-op.
        return toIncidentEntityState(resolved ?? existing);
      },
    });
    if (!resolved) return { status: "notFound" };

    await cache.invalidateForMutation({
      incidentId: resolved.id,
      systemIds: resolved.systemIds,
    });
    await notifyIncidentChanged({
      incidentId: resolved.id,
      systemIds: resolved.systemIds,
      action: "resolved",
    });
    const systemNames = await resolveSystemNames(resolved.systemIds);
    await notifyAffectedSystems({
      catalogClient,
      notificationClient,
      logger,
      incidentId: resolved.id,
      incidentTitle: resolved.title,
      systemIds: resolved.systemIds,
      systemNames,
      action: "resolved",
      severity: resolved.severity,
      updateMessage: message,
    });
    return { status: "resolved", incident: resolved };
  }

  /**
   * Delete a single incident + post-mutation sequence (entity tombstone →
   * cache invalidate → signal). Returns `"notFound"` when the row does not
   * exist, matching the single-item handler's historical `{ success: false }`.
   */
  async function deleteOneIncident(
    id: string,
  ): Promise<"deleted" | "notFound"> {
    const incident = await service.getIncident(id);
    if (!incident) return "notFound";

    let success = false;
    await removeIncidentEntity({
      handle: getIncidentEntity?.(),
      incidentId: id,
      apply: async () => {
        success = await service.deleteIncident(id);
      },
    });
    if (!success) return "notFound";

    await cache.invalidateForMutation({
      incidentId: id,
      systemIds: incident.systemIds,
    });
    await notifyIncidentChanged({
      incidentId: id,
      systemIds: incident.systemIds,
      action: "deleted",
    });
    return "deleted";
  }

  const os = implement(incidentContract)
    .$context<RpcContext>()
    .use(correlationMiddleware)
    .use(autoAuthMiddleware);

  return os.router({
    listIncidents: os.listIncidents.handler(async ({ input }) => {
      return {
        incidents: await cache.wrapList(input ?? {}, () =>
          service.listIncidents(input ?? {}),
        ),
      };
    }),

    resolveIncidentRefs: os.resolveIncidentRefs.handler(async ({ input }) => {
      // Existence is checked here; READ permission is applied by the
      // contract's `listKey: "incidents"` post-filter on the way out. An id
      // that fails either test is simply absent from the response, so a
      // deleted incident and an unreadable one look identical to the caller.
      const ids = await service.findExistingIncidentIds(input.ids);
      return { incidents: ids.map((id) => ({ id })) };
    }),

    getIncident: os.getIncident.handler(async ({ input, context }) => {
      const result = await cache.wrapIncident(input.id, () =>
        service.getIncident(input.id),
      );
      if (!result) {

        return null;
      }
      // Item 3/5: filter updates + hotlinks by the caller's audience SERVER-SIDE
      // (never CSS). The cache stores the full record; visibility is applied
      // per-request so an internal note or logged-in-only link never ships to an
      // anonymous or non-manager caller.
      const audience = await resolveIncidentAudience({
        context: { user: context.user, auth: context.auth },
        incidentId: input.id,
      });
      // User-name resolution stays outside the cache: it's a foreign-system
      // lookup with its own freshness needs and is cheap relative to the
      // incident query.
      // Filter by current visibility, THEN strip the manager-only edit history
      // (a prior version may have been internal before being made public).
      const updatesWithNames = await resolveUserNames(
        scopeEditHistory(filterByAudience(result.updates, audience), audience),
      );
      return {
        ...result,
        updates: updatesWithNames,
        links: filterByAudience(result.links, audience),
      };
    }),

    getIncidentsForSystem: os.getIncidentsForSystem.handler(
      async ({ input }) => {
        return cache.wrapSystem(input.systemId, () =>
          service.getIncidentsForSystem(input.systemId),
        );
      },
    ),

    getBulkIncidentsForSystems: os.getBulkIncidentsForSystems.handler(
      async ({ input }) => {
        // Per-entity caching: each system's incidents are cached individually
        // so dashboards with overlapping (but non-identical) system sets share
        // cache entries. See ./cache.ts for the key/TTL/invalidation contract.
        const incidents: Record<
          string,
          Awaited<ReturnType<typeof service.getIncidentsForSystem>>
        > = {};
        await Promise.all(
          input.systemIds.map(async (systemId) => {
            incidents[systemId] = await cache.wrapSystem(systemId, () =>
              service.getIncidentsForSystem(systemId),
            );
          }),
        );
        return { incidents };
      },
    ),

    getBulkIncidentUpdates: os.getBulkIncidentUpdates.handler(
      async ({ input, context }) => {
        const raw = await service.getBulkIncidentUpdates(input.incidentIds);
        // Mirror getIncident's per-incident audience filter (Item 3/5) so this
        // bulk endpoint can never leak logged-in/internal updates - or author
        // identity - to a caller who is not a manager of that incident. The
        // public status-page widget re-filters to `public` on top; a trusted
        // service call resolves as `manager` and sees all, exactly as
        // getIncident does. Names are resolved per incident (batched within),
        // matching the single-incident read.
        const updates: Record<string, IncidentUpdate[]> = {};
        await Promise.all(
          Object.entries(raw).map(async ([incidentId, list]) => {
            const audience = await resolveIncidentAudience({
              context: { user: context.user, auth: context.auth },
              incidentId,
            });
            updates[incidentId] = await resolveUserNames(
              scopeEditHistory(filterByAudience(list, audience), audience),
            );
          }),
        );
        return { updates };
      },
    ),

    getActiveHealthOverrides: os.getActiveHealthOverrides.handler(
      async ({ input }) => {
        // Deliberately un-cached: this feeds live system-health derivation, so
        // an override must lift/apply the instant an incident is edited or
        // resolved. It is a single indexed join (see service), not an N+1.
        const overrides = await service.getActiveHealthOverrides(
          input.systemIds,
        );
        return { overrides };
      },
    ),

    createIncident: os.createIncident.handler(async ({ input, context }) => {
      const userId =
        context.user && "id" in context.user ? context.user.id : undefined;

      // `teamId` is consumed exclusively by autoAuthMiddleware (create-mode
      // ownership grant). Strip it here so it is never forwarded to the
      // service layer or written into the incident row.
      const { teamId: _teamId, ...serviceInput } = input;

      // Drive the create through the reactive `incident` entity (§10.1):
      // `apply` performs the REAL `incidents`/junction write (the plugin's own
      // db/tx) and returns the new reactive state; the deriver fires
      // `incident.created` from the resulting change. The id is generated up
      // front so the handle is keyed on it and the create's `prev` snapshot
      // correctly reads the not-yet-existing row as absent.
      const incidentId = crypto.randomUUID();
      let result!: Awaited<ReturnType<typeof service.createIncident>>;
      await writeIncidentEntity({
        handle: getIncidentEntity?.(),
        incidentId,
        apply: async () => {
          result = await service.createIncident(serviceInput, userId, incidentId);
          return toIncidentEntityState(result);
        },
      });

      // Invalidate before signal so any frontend that refetches in response
      // sees fresh data. The mutation invariant for every handler in this
      // file is: db.write → cache.invalidate (await) → signals.emit.
      await cache.invalidateForMutation({
        incidentId: result.id,
        systemIds: result.systemIds,
      });

      // Broadcast signal for realtime updates
      await notifyIncidentChanged({
        incidentId: result.id,
        systemIds: result.systemIds,
        action: "created",
      });

      // Send notifications to system subscribers
      const systemNames = await resolveSystemNames(result.systemIds);
      await notifyAffectedSystems({
        catalogClient,
        notificationClient,
        logger,
        incidentId: result.id,
        incidentTitle: result.title,
        systemIds: result.systemIds,
        systemNames,
        action: "created",
        severity: result.severity,
        updateMessage: input.initialMessage,
      });

      return result;
    }),

    updateIncident: os.updateIncident.handler(async ({ input }) => {
      // Probe existence first so a missing incident still surfaces as
      // NOT_FOUND without driving an entity write.
      const exists = await service.getIncident(input.id);
      if (!exists) {
        throw new ORPCError("NOT_FOUND", { message: "Incident not found" });
      }

      // Drive the update through the reactive `incident` entity (§10.1);
      // `apply` performs the REAL update (the plugin's own db/tx) and returns
      // the new reactive state. The deriver fires `incident.updated` (or
      // `incident.resolved` on a resolution) from the resulting change.
      let result!: NonNullable<Awaited<ReturnType<typeof service.updateIncident>>>;
      await writeIncidentEntity({
        handle: getIncidentEntity?.(),
        incidentId: input.id,
        apply: async () => {
          const updated = await service.updateIncident(input);
          if (!updated) {
            throw new ORPCError("NOT_FOUND", { message: "Incident not found" });
          }
          result = updated;
          return toIncidentEntityState(result);
        },
      });

      await cache.invalidateForMutation({
        incidentId: result.id,
        systemIds: result.systemIds,
      });

      // Broadcast signal for realtime updates
      await notifyIncidentChanged({
        incidentId: result.id,
        systemIds: result.systemIds,
        action: "updated",
      });

      // Send notifications to system subscribers
      const systemNames = await resolveSystemNames(result.systemIds);
      await notifyAffectedSystems({
        catalogClient,
        notificationClient,
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

      // Drive the update through the reactive `incident` entity (§10.1).
      // `apply` posts the update row + (optionally) flips status in the
      // plugin's own db/tx, then re-reads the post-write reactive state. The
      // deriver fires `incident.resolved` on a transition to resolved,
      // otherwise `incident.updated` — purely from the entity diff (so the
      // `statusChange` branch collapses into the single driven write). When
      // the status is unchanged, the diff is empty and no event fires.
      let result!: Awaited<ReturnType<typeof service.addUpdate>>;
      let incident: Awaited<ReturnType<typeof service.getIncident>>;
      await writeIncidentEntity({
        handle: getIncidentEntity?.(),
        incidentId: input.incidentId,
        apply: async () => {
          result = await service.addUpdate(input, userId);
          incident = await service.getIncident(input.incidentId);
          // The incident must exist (the update FK-references it); guard for
          // the type and to fail loudly if it vanished mid-write.
          if (!incident) {
            throw new ORPCError("NOT_FOUND", { message: "Incident not found" });
          }
          return toIncidentEntityState(incident);
        },
      });

      if (incident) {
        await cache.invalidateForMutation({
          incidentId: input.incidentId,
          systemIds: incident.systemIds,
        });

        await notifyIncidentChanged({
          incidentId: input.incidentId,
          systemIds: incident.systemIds,
          action: "updated",
        });

        // Notify subscribers on every update EXCEPT an internal-only operator
        // note: an internal update (Item 3/5) must NEVER reach system
        // subscribers. A status change picks the matching verb
        // (resolved / reopened); a message-only update (no status change) still
        // reaches subscribers as an "updated" notification so the latest update
        // text is delivered rather than silently swallowed.
        if (input.visibility !== "internal") {
          const isStatusChange =
            !!input.statusChange && previousStatus !== input.statusChange;

          // Determine notification action based on status transition
          let notificationAction: "resolved" | "reopened" | "updated";
          if (isStatusChange && input.statusChange === "resolved") {
            notificationAction = "resolved";
          } else if (isStatusChange && previousStatus === "resolved") {
            // Reopening: was resolved, now not resolved
            notificationAction = "reopened";
          } else {
            notificationAction = "updated";
          }

          const systemNames = await resolveSystemNames(incident.systemIds);
          await notifyAffectedSystems({
            catalogClient,
            notificationClient,
            logger,
            incidentId: input.incidentId,
            incidentTitle: incident.title,
            systemIds: incident.systemIds,
            systemNames,
            action: notificationAction,
            severity: incident.severity,
            updateMessage: input.message,
          });
        }
      }

      return result;
    }),

    editUpdate: os.editUpdate.handler(async ({ input }) => {
      // Drive the edit through the reactive `incident` entity: a `statusChange`
      // edit on the LATEST update re-derives the incident status (service
      // layer), so `apply` re-reads and returns the post-write reactive state
      // and the deriver fires the right change event. Editing an update never
      // re-notifies subscribers (only status transitions via addUpdate do).
      let updateResult: IncidentUpdate | undefined;
      let incident: Awaited<ReturnType<typeof service.getIncident>>;
      await writeIncidentEntity({
        handle: getIncidentEntity?.(),
        incidentId: input.incidentId,
        apply: async () => {
          updateResult = await service.editUpdate(input);
          if (!updateResult) {
            throw new ORPCError("NOT_FOUND", { message: "Update not found" });
          }
          incident = await service.getIncident(input.incidentId);
          if (!incident) {
            throw new ORPCError("NOT_FOUND", { message: "Incident not found" });
          }
          return toIncidentEntityState(incident);
        },
      });
      if (!updateResult || !incident) {
        throw new ORPCError("NOT_FOUND", { message: "Update not found" });
      }

      await cache.invalidateForMutation({
        incidentId: input.incidentId,
        systemIds: incident.systemIds,
      });
      await notifyIncidentChanged({
        incidentId: input.incidentId,
        systemIds: incident.systemIds,
        action: "updated",
      });
      return updateResult;
    }),

    deleteUpdate: os.deleteUpdate.handler(async ({ input }) => {
      // Probe first: a no-op delete (missing incident/update) must NOT drive an
      // entity write. `getIncident` returns the FULL (unfiltered) timeline, so
      // the presence check is visibility-independent.
      const before = await service.getIncident(input.incidentId);
      if (!before || !before.updates.some((u) => u.id === input.id)) {
        return { success: false };
      }

      // Drive the delete through the reactive `incident` entity: deleting the
      // latest status-bearing update re-derives the incident status (service
      // layer), so `apply` re-reads and returns the post-write reactive state
      // and the deriver fires the right change event (symmetric with editUpdate).
      let incident: Awaited<ReturnType<typeof service.getIncident>>;
      await writeIncidentEntity({
        handle: getIncidentEntity?.(),
        incidentId: input.incidentId,
        apply: async () => {
          await service.deleteUpdate(input.id, input.incidentId);
          incident = await service.getIncident(input.incidentId);
          if (!incident) {
            throw new ORPCError("NOT_FOUND", { message: "Incident not found" });
          }
          return toIncidentEntityState(incident);
        },
      });
      if (incident) {
        await cache.invalidateForMutation({
          incidentId: input.incidentId,
          systemIds: incident.systemIds,
        });
        await notifyIncidentChanged({
          incidentId: input.incidentId,
          systemIds: incident.systemIds,
          action: "updated",
        });
      }
      return { success: true };
    }),

    resolveIncident: os.resolveIncident.handler(async ({ input, context }) => {
      const userId =
        context.user && "id" in context.user ? context.user.id : undefined;

      // Drive the resolve through the shared per-id helper (entity write →
      // cache → signal → notify). A missing incident surfaces as NOT_FOUND.
      const outcome = await resolveOneIncident({
        id: input.id,
        message: input.message,
        userId,
      });
      if (outcome.status !== "resolved" || !outcome.incident) {
        throw new ORPCError("NOT_FOUND", { message: "Incident not found" });
      }
      return outcome.incident;
    }),

    deleteIncident: os.deleteIncident.handler(async ({ input }) => {
      // Shared per-id delete helper drives the reactive `incident` tombstone
      // (§10.1) + cache invalidate + signal. `success` tracks whether the row
      // actually existed and was deleted.
      const status = await deleteOneIncident(input.id);
      return { success: status === "deleted" };
    }),

    bulkDeleteIncidents: os.bulkDeleteIncidents.handler(
      async ({ input, context }) => {
        // The `bulkManage` instance-access mode pre-partitioned `input.ids`
        // into the caller's manageable subset and the denied remainder. A
        // missing partition means we cannot prove authorization, so treat the
        // whole batch as denied (fail closed) rather than acting on any id.
        const partition = context.bulkAccess?.ids ?? {
          authorizedIds: [],
          deniedIds: input.ids,
        };
        const results: BulkIncidentActionResult[] = [];
        for (const id of partition.authorizedIds) {
          try {
            results.push({ id, status: await deleteOneIncident(id) });
          } catch (error) {
            // Isolate per-id failures so one bad row never aborts the batch.
            logger.error(
              `bulkDeleteIncidents: failed to delete incident ${id}`,
              error,
            );
            results.push({ id, status: "error" });
          }
        }
        for (const id of partition.deniedIds) {
          results.push({ id, status: "forbidden" });
        }
        return { results };
      },
    ),

    bulkResolveIncidents: os.bulkResolveIncidents.handler(
      async ({ input, context }) => {
        const userId =
          context.user && "id" in context.user ? context.user.id : undefined;
        const partition = context.bulkAccess?.ids ?? {
          authorizedIds: [],
          deniedIds: input.ids,
        };
        const results: BulkIncidentActionResult[] = [];
        for (const id of partition.authorizedIds) {
          try {
            const outcome = await resolveOneIncident({
              id,
              message: input.message,
              userId,
            });
            results.push({ id, status: outcome.status });
          } catch (error) {
            logger.error(
              `bulkResolveIncidents: failed to resolve incident ${id}`,
              error,
            );
            results.push({ id, status: "error" });
          }
        }
        for (const id of partition.deniedIds) {
          results.push({ id, status: "forbidden" });
        }
        return { results };
      },
    ),

    hasActiveIncidentWithSuppression:
      os.hasActiveIncidentWithSuppression.handler(async ({ input }) => {
        const suppressed = await service.hasActiveIncidentWithSuppression(
          input.systemId,
        );
        return { suppressed };
      }),

    createAutoIncident: os.createAutoIncident.handler(
      async ({ input }) => {
        // No user context for service-initiated incidents; createdBy stays
        // null and the timeline shows the originating plugin via the entity
        // state. Driven through the reactive `incident` entity (§10.1); the
        // deriver fires `incident.created` from the resulting change. The id
        // is generated up front so the create's `prev` snapshot is null.
        const incidentId = crypto.randomUUID();
        let result!: Awaited<ReturnType<typeof service.createIncident>>;
        await writeIncidentEntity({
          handle: getIncidentEntity?.(),
          incidentId,
          apply: async () => {
            result = await service.createIncident(input, undefined, incidentId);
            return toIncidentEntityState(result);
          },
        });

        await cache.invalidateForMutation({
          incidentId: result.id,
          systemIds: result.systemIds,
        });

        await notifyIncidentChanged({
          incidentId: result.id,
          systemIds: result.systemIds,
          action: "created",
        });

        const systemNames = await resolveSystemNames(result.systemIds);
        await notifyAffectedSystems({
          catalogClient,
          notificationClient,
          logger,
          incidentId: result.id,
          incidentTitle: result.title,
          systemIds: result.systemIds,
          systemNames,
          action: "created",
          severity: result.severity,
          updateMessage: input.initialMessage,
        });

        return { id: result.id };
      },
    ),

    resolveAutoIncident: os.resolveAutoIncident.handler(
      async ({ input }) => {
        // Idempotent: a missing incident is treated as success so the
        // auto-close worker can be re-run safely. Probe first so the no-op
        // case never drives an entity write.
        const exists = await service.getIncident(input.id);
        if (!exists) {
          return { success: true };
        }

        // Drive the resolve through the reactive `incident` entity (§10.1):
        // the REAL resolve runs INSIDE `apply`, so `prev` is snapshotted
        // before the status flips and the deriver fires `incident.resolved`
        // from the status → resolved transition. An already-resolved incident
        // yields an empty diff and no event — the idempotent re-run case.
        let result: IncidentWithSystems | undefined;
        await writeIncidentEntity({
          handle: getIncidentEntity?.(),
          incidentId: input.id,
          apply: async () => {
            result = await service.resolveIncident(input.id, input.message);
            // The probe found it; a race could still delete it mid-write.
            // Fall back to the pre-write state so the diff is a no-op.
            return toIncidentEntityState(result ?? exists);
          },
        });
        if (!result) {
          return { success: true };
        }

        await cache.invalidateForMutation({
          incidentId: result.id,
          systemIds: result.systemIds,
        });

        await notifyIncidentChanged({
          incidentId: result.id,
          systemIds: result.systemIds,
          action: "resolved",
        });

        const systemNames = await resolveSystemNames(result.systemIds);
        await notifyAffectedSystems({
          catalogClient,
          notificationClient,
          logger,
          incidentId: result.id,
          incidentTitle: result.title,
          systemIds: result.systemIds,
          systemNames,
          action: "resolved",
          severity: result.severity,
          updateMessage: input.message,
        });

        return { success: true };
      },
    ),

    addLink: os.addLink.handler(async ({ input }) => {
      // Verify incident exists so the FK violation surfaces as NOT_FOUND.
      const incident = await service.getIncident(input.incidentId);
      if (!incident) {
        throw new ORPCError("NOT_FOUND", { message: "Incident not found" });
      }
      const link = await service.addLink(input);
      await cache.invalidateForMutation({
        incidentId: incident.id,
        systemIds: incident.systemIds,
      });
      return link;
    }),

    updateLink: os.updateLink.handler(async ({ input }) => {
      const link = await service.updateLink(input);
      if (!link) {
        throw new ORPCError("NOT_FOUND", { message: "Link not found" });
      }
      const incident = await service.getIncident(input.incidentId);
      if (incident) {
        await cache.invalidateForMutation({
          incidentId: incident.id,
          systemIds: incident.systemIds,
        });
      }
      return link;
    }),

    removeLink: os.removeLink.handler(async ({ input }) => {
      const incidentId = await service.removeLink(input.id, input.incidentId);
      if (!incidentId) {
        return { success: false };
      }
      const incident = await service.getIncident(incidentId);
      if (incident) {
        await cache.invalidateForMutation({
          incidentId,
          systemIds: incident.systemIds,
        });
      }
      return { success: true };
    }),
  });
}
