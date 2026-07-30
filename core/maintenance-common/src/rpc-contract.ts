import { z } from "zod";
import { createClientDefinition, proc } from "@checkstack/common";
import { maintenanceAccess } from "./access";
import { pluginMetadata } from "./plugin-metadata";
import {
  MaintenanceWithSystemsSchema,
  MaintenanceDetailSchema,
  MaintenanceUpdateSchema,
  MaintenanceLinkSchema,
  AddMaintenanceLinkInputSchema,
  CreateMaintenanceInputSchema,
  UpdateMaintenanceInputSchema,
  AddMaintenanceUpdateInputSchema,
  EditMaintenanceUpdateInputSchema,
  DeleteMaintenanceUpdateInputSchema,
  UpdateMaintenanceLinkInputSchema,
  MaintenanceStatusEnum,
  BulkMaintenanceActionResultSchema,
  BulkMaintenanceIdsInputSchema,
  BulkCloseMaintenancesInputSchema,
} from "./schemas";

export const maintenanceContract = {
  /** List all maintenances with optional status filter */
  listMaintenances: proc({
    operationType: "query",
    userType: "public",
    access: [maintenanceAccess.maintenance.read],
    // The shared `maintenance` rule declares `idParam: "systemId"`, but grants
    // are keyed per-MAINTENANCE id (see frontend TeamAccessEditor
    // resourceType="maintenance.maintenance" resourceId={maintenance.id}). This
    // list returns `{ maintenances: [...] }`; each item has a string `.id` that
    // equals the grant resourceId, so post-filter by `maintenances`.
    instanceAccess: { listKey: "maintenances" },
  })
    .input(
      z
        .object({
          status: MaintenanceStatusEnum.optional(),
          systemId: z.string().optional(),
          includeCompleted: z.boolean().optional().default(false),
        })
        .optional(),
    )
    .output(z.object({ maintenances: z.array(MaintenanceWithSystemsSchema) })),

  /** Get a single maintenance with all details */
  /**
   * Of the given maintenance ids, which may the caller READ?
   *
   * Backs viewability-aware mention rendering: a `#` reference becomes a link
   * only when the reader may actually open it, and renders as plain text
   * otherwise. See `resolveIncidentRefs` in `@checkstack/incident-common` for
   * the full rationale - the two are deliberately identical in shape.
   *
   * Returns only ids, and only for readable maintenances, so an unreadable or
   * deleted one is indistinguishable from one that never existed.
   */
  resolveMaintenanceRefs: proc({
    operationType: "query",
    userType: "public",
    access: [maintenanceAccess.maintenance.read],
    // Same per-id read post-filter as `listMaintenances`, so this can never be
    // more permissive than the list.
    instanceAccess: { listKey: "maintenances" },
  })
    .input(z.object({ ids: z.array(z.string()).max(200) }))
    .output(z.object({ maintenances: z.array(z.object({ id: z.string() })) })),

  getMaintenance: proc({
    operationType: "query",
    userType: "public",
    access: [maintenanceAccess.maintenance.read],
    // OBJECT-scoped: grants are keyed per-MAINTENANCE id, so pre-check the
    // maintenance's own id. Without this override the shared rule's
    // `idParam: "systemId"` finds nothing on `{ id }` and skips the check (G9).
    instanceAccess: { idParam: "id" },
    accessNote: {
      summary:
        "the base read is gated above; ADDITIONALLY the response is audience-" +
        "graded in the handler: internal-audience updates and edit history are " +
        "shown only to a caller who can MANAGE the maintenance, everyone else sees " +
        "the public-audience subset.",
    },
  })
    .input(z.object({ id: z.string() }))
    .output(MaintenanceDetailSchema.nullable()),

  /** Get active or upcoming maintenances for a specific system */
  // SYSTEM-scoped: input has `systemId`; output is a bare array so `listKey` is
  // not applicable, but `parentScope` with `idParam` gates on the owning system
  // grant directly — no wrapper key required.
  getMaintenancesForSystem: proc({
    operationType: "query",
    userType: "public",
    access: [maintenanceAccess.maintenance.read],
    instanceAccess: {
      parentScope: {
        resourceType: "catalog.system",
        action: "read",
        idParam: "systemId",
      },
    },
  })
    .input(z.object({ systemId: z.string() }))
    .output(z.array(MaintenanceWithSystemsSchema)),

  /** Get active maintenances for multiple systems in a single request.
   * Used for efficient dashboard rendering to avoid N+1 queries.
   */
  // SYSTEM-scoped bulk: output `maintenances` is `Record<systemId, Maintenance[]>`,
  // so `parentScope` with `recordKey` gates on catalog.system access for each key.
  getBulkMaintenancesForSystems: proc({
    operationType: "query",
    userType: "public",
    access: [maintenanceAccess.maintenance.read],
    instanceAccess: {
      parentScope: {
        resourceType: "catalog.system",
        action: "read",
        recordKey: "maintenances",
      },
    },
  })
    .route({ method: "POST" })
    .input(z.object({ systemIds: z.array(z.string()) }))
    .output(
      z.object({
        maintenances: z.record(
          z.string(),
          z.array(MaintenanceWithSystemsSchema),
        ),
      }),
    ),

  /**
   * Bulk fetch of each maintenance's update timeline, keyed by maintenance id.
   * Backs the public status page's maintenance widget so rendering the update
   * timeline for N windows costs ONE request instead of an N+1 fan-out of
   * {@link getMaintenance} (which the widget was calling purely for `.updates`).
   * The handler applies the SAME per-maintenance audience filter as
   * `getMaintenance` (Item 3/5), so logged-in/internal updates and author
   * identity never reach a caller who is not a manager of that maintenance; the
   * public widget re-filters to `public` on top.
   *
   * `recordKey: "updates"` mirrors `getMaintenance`'s own-object read gate
   * (`idParam: "id"`) as a record post-filter: each maintenance-id key is
   * checked against the caller's `maintenance.maintenance` read grant, exactly
   * like `listMaintenances`' `listKey`. Maintenances with no updates are omitted.
   */
  getBulkMaintenanceUpdates: proc({
    operationType: "query",
    userType: "public",
    access: [maintenanceAccess.maintenance.read],
    instanceAccess: { recordKey: "updates" },
    accessNote: {
      summary:
        "per-record read is gated above; ADDITIONALLY each maintenance's updates " +
        "are audience-graded in the handler - internal-audience updates appear " +
        "only to a caller who can MANAGE that maintenance.",
    },
  })
    .route({ method: "POST" })
    .input(z.object({ maintenanceIds: z.array(z.string()) }))
    .output(
      z.object({
        updates: z.record(z.string(), z.array(MaintenanceUpdateSchema)),
      }),
    ),

  /**
   * Get maintenance windows that OVERLAP a time range `[from, to]` for the
   * given systems, INCLUDING already-completed windows and EXCLUDING only
   * `cancelled` ones. Unlike `getBulkMaintenancesForSystems` (active/scheduled
   * only), this backs TRAILING-window budget math (the SLO error-budget
   * maintenance exclusion): a planned maintenance that has since completed must
   * still be subtracted, and the subtracted amount must not jump when the
   * window transitions `scheduled -> in_progress -> completed`. Overlap test is
   * `startAt <= to AND endAt >= from`. Output is `Record<systemId, windows[]>`,
   * so `parentScope` with `recordKey` gates on catalog.system access per key
   * (a trusted service-to-service loopback caller passes the gate).
   */
  getMaintenanceWindowsForRange: proc({
    operationType: "query",
    userType: "public",
    access: [maintenanceAccess.maintenance.read],
    instanceAccess: {
      parentScope: {
        resourceType: "catalog.system",
        action: "read",
        recordKey: "maintenances",
      },
    },
  })
    .route({ method: "POST" })
    .input(
      z.object({
        systemIds: z.array(z.string()),
        from: z.date(),
        to: z.date(),
      }),
    )
    .output(
      z.object({
        maintenances: z.record(
          z.string(),
          z.array(MaintenanceWithSystemsSchema),
        ),
      }),
    ),

  /** Create a new maintenance */
  createMaintenance: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [maintenanceAccess.maintenance.manage],
    // CREATE-MODE team ownership: middleware pre-checks create-capability and
    // post-write sets the owning-team grant keyed as
    // `maintenance.maintenance / <created id>` (the idField "id" on the
    // MaintenanceWithSystemsSchema response). The `teamId` input field is
    // optional so existing callers that omit it continue to work globally.
    instanceAccess: {
      create: {
        teamIdParam: "teamId",
        idField: "id",
        // Anyone who can MANAGE a referenced system may create one for it; the
        // result stays globally readable. Falls back to a per-type
        // create-capability grant when no parent gate matches.
        parent: { resourceType: "catalog.system", idParam: "systemIds" },
      },
    },
  })
    .input(CreateMaintenanceInputSchema)
    .output(MaintenanceWithSystemsSchema),

  /** Update an existing maintenance */
  updateMaintenance: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [maintenanceAccess.maintenance.manage],
    // OBJECT-scoped: pre-check the maintenance's own grant (G9 fix).
    instanceAccess: { idParam: "id" },
  })
    .route({ method: "PATCH" })
    .input(UpdateMaintenanceInputSchema)
    .output(MaintenanceWithSystemsSchema),

  /** Add a status update to a maintenance */
  addUpdate: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [maintenanceAccess.maintenance.manage],
    // OBJECT-scoped: input carries the maintenance id as `maintenanceId`.
    instanceAccess: { idParam: "maintenanceId" },
  })
    .input(AddMaintenanceUpdateInputSchema)
    .output(MaintenanceUpdateSchema),

  /**
   * Edit a published update in place. Object-scoped on the OWNING maintenance
   * via `maintenanceId` (mirrors addUpdate). The handler scopes the write by
   * `maintenanceId`, and a `statusChange` edit on the LATEST update re-derives
   * the maintenance status. Sets `editedAt`.
   */
  editUpdate: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [maintenanceAccess.maintenance.manage],
    instanceAccess: { idParam: "maintenanceId" },
  })
    .route({ method: "PATCH" })
    .input(EditMaintenanceUpdateInputSchema)
    .output(MaintenanceUpdateSchema),

  /**
   * Delete a published update. Object-scoped on the OWNING maintenance via
   * `maintenanceId` (mirrors removeLink); the handler scopes the delete by
   * `maintenanceId`.
   */
  deleteUpdate: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [maintenanceAccess.maintenance.manage],
    instanceAccess: { idParam: "maintenanceId" },
  })
    .route({ method: "DELETE" })
    .input(DeleteMaintenanceUpdateInputSchema)
    .output(z.object({ success: z.boolean() })),

  /** Close a maintenance early (sets status to completed) */
  closeMaintenance: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [maintenanceAccess.maintenance.manage],
    // OBJECT-scoped: pre-check the maintenance's own grant (G9 fix).
    instanceAccess: { idParam: "id" },
  })
    .input(z.object({ id: z.string(), message: z.string().optional() }))
    .output(MaintenanceWithSystemsSchema),

  /** Add a hotlink (e.g. change ticket, runbook) to a maintenance */
  addLink: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [maintenanceAccess.maintenance.manage],
    // OBJECT-scoped: input carries the maintenance id as `maintenanceId`.
    instanceAccess: { idParam: "maintenanceId" },
  })
    .input(AddMaintenanceLinkInputSchema)
    .output(MaintenanceLinkSchema),

  /**
   * Edit a hotlink in place. Object-scoped on the OWNING maintenance via
   * `maintenanceId` (mirrors removeLink), so a team-scoped maintenance manager
   * may edit links on their own maintenance without the global rule. The handler
   * additionally scopes the update by `maintenanceId`, so a link id cannot be
   * paired with a foreign maintenance the caller happens to manage.
   */
  updateLink: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [maintenanceAccess.maintenance.manage],
    instanceAccess: { idParam: "maintenanceId" },
  })
    .route({ method: "PATCH" })
    .input(UpdateMaintenanceLinkInputSchema)
    .output(MaintenanceLinkSchema),

  /** Remove a hotlink from a maintenance */
  removeLink: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [maintenanceAccess.maintenance.manage],
    // Object-scoped on the OWNING maintenance via `maintenanceId` (mirrors
    // addLink), so a team-scoped maintenance manager may remove links on their
    // own maintenance without the global rule. The handler additionally scopes
    // the delete by `maintenanceId`, so a link id cannot be paired with a foreign
    // maintenance the caller happens to manage.
    instanceAccess: { idParam: "maintenanceId" },
  })
    .route({ method: "DELETE" })
    .input(z.object({ id: z.string(), maintenanceId: z.string() }))
    .output(z.object({ success: z.boolean() })),

  /** Delete a maintenance */
  deleteMaintenance: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [maintenanceAccess.maintenance.manage],
    // OBJECT-scoped: `id` is the maintenance's own id (G9 fix).
    instanceAccess: { idParam: "id" },
  })
    .route({ method: "DELETE" })
    .input(z.object({ id: z.string() }))
    .output(z.object({ success: z.boolean() })),

  /**
   * Mass-delete maintenances, authorizing EACH id against the caller's manage
   * grant via the `bulkManage` instance-access mode. `input.ids` is
   * pre-partitioned into the caller's manageable subset and the denied
   * remainder BEFORE the handler runs, so an unauthorized id is never deleted.
   * Returns a per-id result for partial-success reporting.
   */
  bulkDeleteMaintenances: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [maintenanceAccess.maintenance.manage],
    instanceAccess: { bulkManage: { idsParam: "ids" } },
  })
    .route({ method: "POST" })
    .input(BulkMaintenanceIdsInputSchema)
    .output(z.object({ results: z.array(BulkMaintenanceActionResultSchema) })),

  /**
   * Mass-close maintenances (the "resolve"-equivalent: status → completed,
   * mirroring the single-item `closeMaintenance`). Authorizes EACH id against
   * the caller's manage grant via the `bulkManage` mode; only authorized ids
   * are closed and a per-id result is returned. Already-completed/cancelled or
   * missing ids are reported, never fatal.
   */
  bulkCloseMaintenances: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [maintenanceAccess.maintenance.manage],
    instanceAccess: { bulkManage: { idsParam: "ids" } },
  })
    .route({ method: "POST" })
    .input(BulkCloseMaintenancesInputSchema)
    .output(z.object({ results: z.array(BulkMaintenanceActionResultSchema) })),

  /** Check if a system has active maintenance with notification suppression enabled.
   * Used by healthcheck to skip notifications during expected downtime.
   * Service-to-service endpoint (not exposed to users).
   */
  hasActiveMaintenanceWithSuppression: proc({
    operationType: "query",
    userType: "service",
    access: [],
  })
    .input(z.object({ systemId: z.string() }))
    .output(z.object({ suppressed: z.boolean() })),

  /** Check if a system currently has an active maintenance window,
   * regardless of notification-suppression. Used by automations and the
   * health-state provider to gate on maintenance state without coupling
   * to the suppression flag. Service-to-service endpoint.
   */
  hasActiveMaintenance: proc({
    operationType: "query",
    userType: "service",
    access: [],
  })
    .input(z.object({ systemId: z.string() }))
    .output(z.object({ active: z.boolean() })),
};

// Export contract type
export type MaintenanceContract = typeof maintenanceContract;

// Export client definition for type-safe forPlugin usage
// Use: const client = rpcApi.forPlugin(MaintenanceApi);
export const MaintenanceApi = createClientDefinition(
  maintenanceContract,
  pluginMetadata,
);
