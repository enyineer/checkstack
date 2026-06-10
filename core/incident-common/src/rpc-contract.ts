import { z } from "zod";
import { createClientDefinition, proc } from "@checkstack/common";
import { incidentAccess } from "./access";
import { pluginMetadata } from "./plugin-metadata";
import {
  IncidentWithSystemsSchema,
  IncidentDetailSchema,
  IncidentUpdateSchema,
  IncidentLinkSchema,
  AddIncidentLinkInputSchema,
  CreateIncidentInputSchema,
  UpdateIncidentInputSchema,
  AddIncidentUpdateInputSchema,
  IncidentStatusEnum,
} from "./schemas";

export const incidentContract = {
  /** List all incidents with optional filters */
  listIncidents: proc({
    operationType: "query",
    userType: "public",
    access: [incidentAccess.incident.read],
    // Grants are keyed by INCIDENT id (frontend `TeamAccessEditor` writes
    // `resourceType="incident.incident"`, `resourceId={incident.id}`). Each
    // returned item is an `IncidentWithSystems` whose `.id` is the incident id,
    // so the list post-filter matches grants correctly.
    instanceAccess: { listKey: "incidents" },
  })
    .input(
      z
        .object({
          status: IncidentStatusEnum.optional(),
          systemId: z.string().optional(),
          includeResolved: z.boolean().optional().default(false),
        })
        .optional(),
    )
    .output(z.object({ incidents: z.array(IncidentWithSystemsSchema) })),

  /** Get a single incident with all details */
  getIncident: proc({
    operationType: "query",
    userType: "public",
    access: [incidentAccess.incident.read],
    // Object-scoped: gate on the incident's OWN grant. The shared `incident`
    // access rule declares `idParam: "systemId"`, but grants are keyed by
    // incident id and this input carries `id` (no `systemId`), so without this
    // override the middleware would find no id and SKIP the check (G9 bug).
    instanceAccess: { idParam: "id" },
  })
    .input(z.object({ id: z.string() }))
    .output(IncidentDetailSchema.nullable()),

  /** Get active incidents for a specific system */
  getIncidentsForSystem: proc({
    operationType: "query",
    userType: "public",
    access: [incidentAccess.incident.read],
    // SYSTEM-scoped read: input carries `systemId` and this endpoint returns
    // incidents FOR that system. Access follows "can you read that system"
    // (catalog.system / read), not incident-level grants.
    instanceAccess: {
      parentScope: { resourceType: "catalog.system", action: "read", idParam: "systemId" },
    },
  })
    .input(z.object({ systemId: z.string() }))
    .output(z.array(IncidentWithSystemsSchema)),

  /** Get active incidents for multiple systems in a single request.
   * Used for efficient dashboard rendering to avoid N+1 queries.
   */
  getBulkIncidentsForSystems: proc({
    operationType: "query",
    userType: "public",
    access: [incidentAccess.incident.read],
    // SYSTEM-scoped bulk read: output is `{ incidents: Record<systemId, ...> }`.
    // The record is keyed by system id, so access follows per-system catalog
    // visibility — the validator post-filters the record to only the system ids
    // the caller can read.
    instanceAccess: {
      parentScope: { resourceType: "catalog.system", action: "read", recordKey: "incidents" },
    },
  })
    .route({ method: "POST" })
    .input(z.object({ systemIds: z.array(z.string()) }))
    .output(
      z.object({
        incidents: z.record(z.string(), z.array(IncidentWithSystemsSchema)),
      }),
    ),

  /** Create a new incident */
  createIncident: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [incidentAccess.incident.manage],
    // CREATE-mode team ownership: the autoAuthMiddleware reads `input.teamId`
    // (optional) to resolve the owning team and, post-handler, writes a
    // team-scoped grant keyed `incident.incident / {incident.id}` via
    // `setResourceOwner`. The `idField: "id"` tells the middleware which field
    // of the response carries the new resource's id. Grants are keyed by
    // incident id, matching the `TeamAccessEditor` usage in IncidentEditor.
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
    .input(CreateIncidentInputSchema)
    .output(IncidentWithSystemsSchema),

  /** Update an existing incident */
  updateIncident: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [incidentAccess.incident.manage],
    // Object-scoped: gate on the incident's OWN grant via the `id` input.
    // Overrides the rule's `idParam: "systemId"` (G9 bug — no `systemId` here).
    instanceAccess: { idParam: "id" },
  })
    .route({ method: "PATCH" })
    .input(UpdateIncidentInputSchema)
    .output(IncidentWithSystemsSchema),

  /** Add a status update to an incident */
  addUpdate: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [incidentAccess.incident.manage],
    // Object-scoped: gate on the incident's OWN grant. This input carries the
    // incident id as `incidentId` (not `id`). Overrides the rule's
    // `idParam: "systemId"` (G9 bug — no `systemId` here).
    instanceAccess: { idParam: "incidentId" },
  })
    .input(AddIncidentUpdateInputSchema)
    .output(IncidentUpdateSchema),

  /** Resolve an incident (sets status to resolved) */
  resolveIncident: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [incidentAccess.incident.manage],
    // Object-scoped: gate on the incident's OWN grant via the `id` input.
    // Overrides the rule's `idParam: "systemId"` (G9 bug — no `systemId` here).
    instanceAccess: { idParam: "id" },
  })
    .input(z.object({ id: z.string(), message: z.string().optional() }))
    .output(IncidentWithSystemsSchema),

  /** Add a hotlink (e.g. Jira ticket, runbook) to an incident */
  addLink: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [incidentAccess.incident.manage],
    // Object-scoped: gate on the incident's OWN grant via the `incidentId`
    // input. Overrides the rule's `idParam: "systemId"` (G9 bug).
    instanceAccess: { idParam: "incidentId" },
  })
    .input(AddIncidentLinkInputSchema)
    .output(IncidentLinkSchema),

  /** Remove a hotlink from an incident */
  removeLink: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [incidentAccess.incident.manage],
    // global:true — input carries only a LINK id (`incidentLinks.id`), not an
    // incident id or system id. The owning incident id is only resolvable
    // server-side after the lookup, so no pre-check can scope this to a resource.
    // `idParam: "id"` would compare a link id against incident grants and always
    // 403. The `incident.manage` access rule still gates this endpoint globally.
    instanceAccess: { global: true },
  })
    .route({ method: "DELETE" })
    .input(z.object({ id: z.string() }))
    .output(z.object({ success: z.boolean() })),

  /** Delete an incident */
  deleteIncident: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [incidentAccess.incident.manage],
    // Object-scoped: gate on the incident's OWN grant via the `id` input.
    // Overrides the rule's `idParam: "systemId"` (G9 bug — no `systemId` here).
    instanceAccess: { idParam: "id" },
  })
    .route({ method: "DELETE" })
    .input(z.object({ id: z.string() }))
    .output(z.object({ success: z.boolean() })),

  /**
   * Check if a system has an active incident with notification suppression enabled.
   * Used by the health check system to suppress notifications during acknowledged incidents.
   */
  hasActiveIncidentWithSuppression: proc({
    operationType: "query",
    userType: "service",
    access: [incidentAccess.incident.read],
  })
    .input(z.object({ systemId: z.string() }))
    .output(z.object({ suppressed: z.boolean() })),

  /**
   * Open an incident on behalf of another plugin (no user context).
   * Used by automated systems like the health-check auto-incident flow.
   * Always single-system. Returns the created incident's id so the
   * caller can store it for later resolution.
   */
  createAutoIncident: proc({
    operationType: "mutation",
    userType: "service",
    access: [],
  })
    .input(CreateIncidentInputSchema)
    .output(z.object({ id: z.string() })),

  /**
   * Resolve an incident on behalf of another plugin. Used by automated
   * systems (e.g. the health-check auto-close worker) to close
   * incidents they previously opened. Idempotent: resolving an already-
   * resolved incident returns success without error.
   */
  resolveAutoIncident: proc({
    operationType: "mutation",
    userType: "service",
    access: [],
  })
    .input(z.object({ id: z.string(), message: z.string().optional() }))
    .output(z.object({ success: z.boolean() })),
};

// Export contract type
export type IncidentContract = typeof incidentContract;

// Export client definition for type-safe forPlugin usage
// Use: const client = rpcApi.forPlugin(IncidentApi);
export const IncidentApi = createClientDefinition(
  incidentContract,
  pluginMetadata,
);
