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
  EditIncidentUpdateInputSchema,
  DeleteIncidentUpdateInputSchema,
  UpdateIncidentLinkInputSchema,
  IncidentStatusEnum,
  IncidentHealthOverrideEnum,
  BulkIncidentActionResultSchema,
  BulkIncidentIdsInputSchema,
  BulkResolveIncidentsInputSchema,
} from "./schemas";

/**
 * One active incident forcing a health status onto a system. Returned by
 * `getActiveHealthOverrides` and consumed by `@checkstack/healthcheck-backend`
 * to fold incident overrides into a system's derived health (worst-wins).
 */
export const SystemHealthOverrideSchema = z.object({
  status: IncidentHealthOverrideEnum,
  incidentId: z.string(),
  incidentTitle: z.string(),
});
export type SystemHealthOverride = z.infer<typeof SystemHealthOverrideSchema>;

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
    accessNote: {
      summary:
        "the base read is gated above; ADDITIONALLY the response is audience-" +
        "graded in the handler: internal-audience updates, links and edit history " +
        "are shown only to a caller who can MANAGE the incident (global manage or " +
        "a manager of its system), everyone else sees the public-audience subset.",
    },
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

  /**
   * Bulk fetch of each incident's update timeline, keyed by incident id. Backs
   * the public status page's incidents widget so rendering the update timeline
   * for N incidents costs ONE request instead of an N+1 fan-out of
   * {@link getIncident} (which the widget was calling purely for `.updates`).
   * The handler applies the SAME per-incident audience filter as `getIncident`
   * (Item 3/5), so logged-in/internal updates and author identity never reach a
   * caller who is not a manager of that incident; the public widget re-filters
   * to `public` on top.
   *
   * `recordKey: "updates"` mirrors `getIncident`'s own-incident read gate
   * (`idParam: "id"`) as a record post-filter: each incident-id key is checked
   * against the caller's `incident.incident` read grant, exactly like
   * `listIncidents`' `listKey`. Incidents with no updates are omitted.
   */
  getBulkIncidentUpdates: proc({
    operationType: "query",
    userType: "public",
    access: [incidentAccess.incident.read],
    instanceAccess: { recordKey: "updates" },
    accessNote: {
      summary:
        "per-record read is gated above; ADDITIONALLY each incident's updates are " +
        "audience-graded in the handler - internal-audience updates appear only to " +
        "a caller who can MANAGE that incident.",
    },
  })
    .route({ method: "POST" })
    .input(z.object({ incidentIds: z.array(z.string()) }))
    .output(
      z.object({
        updates: z.record(z.string(), z.array(IncidentUpdateSchema)),
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

  /**
   * Edit a published update in place. Object-scoped on the OWNING incident via
   * `incidentId` (mirrors addUpdate), so a team-scoped incident manager may edit
   * updates on their own incident without the global rule. The handler scopes
   * the write by `incidentId`, and a `statusChange` edit on the LATEST update
   * re-derives the incident's status. Sets `editedAt`.
   */
  editUpdate: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [incidentAccess.incident.manage],
    instanceAccess: { idParam: "incidentId" },
  })
    .route({ method: "PATCH" })
    .input(EditIncidentUpdateInputSchema)
    .output(IncidentUpdateSchema),

  /**
   * Delete a published update. Object-scoped on the OWNING incident via
   * `incidentId` (mirrors removeLink); the handler scopes the delete by
   * `incidentId` so an update id cannot be paired with a foreign incident.
   */
  deleteUpdate: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [incidentAccess.incident.manage],
    instanceAccess: { idParam: "incidentId" },
  })
    .route({ method: "DELETE" })
    .input(DeleteIncidentUpdateInputSchema)
    .output(z.object({ success: z.boolean() })),

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

  /**
   * Edit a hotlink in place. Object-scoped on the OWNING incident via
   * `incidentId` (mirrors removeLink), so a team-scoped incident manager may
   * edit links on their own incident without the global rule. The handler
   * additionally scopes the update by `incidentId`, so a link id cannot be
   * paired with a foreign incident the caller happens to manage.
   */
  updateLink: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [incidentAccess.incident.manage],
    instanceAccess: { idParam: "incidentId" },
  })
    .route({ method: "PATCH" })
    .input(UpdateIncidentLinkInputSchema)
    .output(IncidentLinkSchema),

  /** Remove a hotlink from an incident */
  removeLink: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [incidentAccess.incident.manage],
    // Object-scoped on the OWNING incident via `incidentId` (mirrors addLink),
    // so a team-scoped incident manager may remove links on their own incident
    // without the global rule. The handler additionally scopes the delete by
    // `incidentId`, so a link id cannot be paired with a foreign incident the
    // caller happens to manage.
    instanceAccess: { idParam: "incidentId" },
  })
    .route({ method: "DELETE" })
    .input(z.object({ id: z.string(), incidentId: z.string() }))
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
   * Mass-delete incidents, authorizing EACH id against the caller's manage
   * grant. The `bulkManage` instance-access mode pre-partitions `input.ids`
   * into the caller's manageable subset (global rule OR per-incident team
   * grant) and the denied remainder BEFORE the handler runs, so an
   * unauthorized id is never deleted. Returns a per-id result so the frontend
   * can report partial success; a denied id is reported as `forbidden`, never a
   * hard failure of the whole batch.
   */
  bulkDeleteIncidents: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [incidentAccess.incident.manage],
    instanceAccess: { bulkManage: { idsParam: "ids" } },
  })
    .route({ method: "POST" })
    .input(BulkIncidentIdsInputSchema)
    .output(z.object({ results: z.array(BulkIncidentActionResultSchema) })),

  /**
   * Mass-resolve incidents (mirrors the single-item `resolveIncident`: status →
   * resolved). Authorizes EACH id against the caller's manage grant via the
   * `bulkManage` mode; only authorized ids are resolved and a per-id result is
   * returned. Already-resolved or missing ids are reported, never fatal.
   */
  bulkResolveIncidents: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [incidentAccess.incident.manage],
    instanceAccess: { bulkManage: { idsParam: "ids" } },
  })
    .route({ method: "POST" })
    .input(BulkResolveIncidentsInputSchema)
    .output(z.object({ results: z.array(BulkIncidentActionResultSchema) })),

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
   * Return, for each requested system, the health overrides contributed by its
   * currently ACTIVE incidents (status != resolved, `healthOverride` set).
   * Server-to-server read used by `@checkstack/healthcheck-backend` to fold
   * incident overrides into a system's derived health via worst-wins. Systems
   * with no active override are omitted from the record. Resolved incidents
   * never appear, so an override auto-lifts the moment its incident resolves.
   */
  getActiveHealthOverrides: proc({
    operationType: "query",
    userType: "service",
    access: [incidentAccess.incident.read],
  })
    .route({ method: "POST" })
    .input(z.object({ systemIds: z.array(z.string()) }))
    .output(
      z.object({
        overrides: z.record(z.string(), z.array(SystemHealthOverrideSchema)),
      }),
    ),

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
