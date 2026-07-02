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
  getMaintenance: proc({
    operationType: "query",
    userType: "public",
    access: [maintenanceAccess.maintenance.read],
    // OBJECT-scoped: grants are keyed per-MAINTENANCE id, so pre-check the
    // maintenance's own id. Without this override the shared rule's
    // `idParam: "systemId"` finds nothing on `{ id }` and skips the check (G9).
    instanceAccess: { idParam: "id" },
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

  /** Remove a hotlink from a maintenance */
  removeLink: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [maintenanceAccess.maintenance.manage],
    // GLOBAL: `id` is the LINK id, not the maintenance id. There is no
    // maintenanceId or systemId in the input to scope on without a breaking
    // schema change. `global: true` preserves current behavior safely.
    instanceAccess: { global: true },
  })
    .route({ method: "DELETE" })
    .input(z.object({ id: z.string() }))
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
