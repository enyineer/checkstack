import { z } from "zod";

/**
 * Incident status enum values.
 * Represents the lifecycle stages of an incident.
 */
export const IncidentStatusEnum = z.enum([
  "investigating",
  "identified",
  "fixing",
  "monitoring",
  "resolved",
]);
export type IncidentStatus = z.infer<typeof IncidentStatusEnum>;

/**
 * Incident severity enum values.
 * Represents the impact level of an incident.
 */
export const IncidentSeverityEnum = z.enum(["minor", "major", "critical"]);
export type IncidentSeverity = z.infer<typeof IncidentSeverityEnum>;

/**
 * Optional health status an incident forces onto its affected systems while the
 * incident is active (not resolved). It is a DELIBERATE user choice, independent
 * of the incident's `severity` - the operator picks how the components should
 * read on every health surface, not a value derived from impact ranking.
 *
 * Deliberately a subset of the health-check status vocabulary
 * (`healthy | degraded | unhealthy`): forcing a system to `healthy` via an
 * incident makes no sense, so only the two "problem" states are offered. The
 * override folds into the system's health via worst-wins alongside the
 * automated checks (see `@checkstack/healthcheck-backend`), so a check reporting
 * something worse always wins.
 */
export const IncidentHealthOverrideEnum = z.enum(["degraded", "unhealthy"]);
export type IncidentHealthOverride = z.infer<typeof IncidentHealthOverrideEnum>;

/**
 * Audience for an incident update or hotlink.
 *
 * - `public`: visible to everyone, including anonymous visitors and the public
 *   status page.
 * - `logged_in`: visible only to authenticated users (hidden from anonymous
 *   reads and the public status-page projection).
 * - `internal`: an operator-only note, visible only to incident managers.
 *
 * Filtering is enforced SERVER-SIDE on the read path (never CSS) - a hidden
 * item never ships in the payload.
 */
export const IncidentVisibilityEnum = z.enum([
  "public",
  "logged_in",
  "internal",
]);
export type IncidentVisibility = z.infer<typeof IncidentVisibilityEnum>;

/**
 * Core incident entity schema
 */
export const IncidentSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  status: IncidentStatusEnum,
  severity: IncidentSeverityEnum,
  suppressNotifications: z.boolean(),
  /**
   * Optional health status forced onto the incident's affected systems while it
   * is active. `null` (the default) means the incident does not touch derived
   * system health. See {@link IncidentHealthOverrideEnum}.
   */
  healthOverride: IncidentHealthOverrideEnum.nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Incident = z.infer<typeof IncidentSchema>;

/**
 * Incident with related systems
 */
export const IncidentWithSystemsSchema = IncidentSchema.extend({
  systemIds: z.array(z.string()),
});
export type IncidentWithSystems = z.infer<typeof IncidentWithSystemsSchema>;

/**
 * A prior version of an incident update, archived when the update is edited in
 * place. Captures every field an edit can change PLUS the published time
 * (`createdAt`) that version carried, so the timeline can show a GitHub-style
 * "history of edits". Timestamps are ISO strings because the array is persisted
 * as a `jsonb` column and round-trips through JSON.
 *
 * This is MANAGER-FACING detail: a prior version may have been `internal` before
 * being made `public`, so the read path only attaches `editHistory` for the
 * manager audience (see `incident-backend/read-visibility`). Never ship it to a
 * public / logged-in reader, or prior internal content would leak.
 */
export const IncidentUpdateEditSnapshotSchema = z.object({
  message: z.string(),
  statusChange: IncidentStatusEnum.optional(),
  visibility: IncidentVisibilityEnum,
  /** The published time this version carried before the edit (ISO string). */
  createdAt: z.string(),
  /** When this version was superseded, i.e. the edit timestamp (ISO string). */
  editedAt: z.string(),
});
export type IncidentUpdateEditSnapshot = z.infer<
  typeof IncidentUpdateEditSnapshotSchema
>;

/**
 * Incident update schema - status updates posted to an incident
 */
export const IncidentUpdateSchema = z.object({
  id: z.string(),
  incidentId: z.string(),
  message: z.string(),
  statusChange: IncidentStatusEnum.optional(),
  /** Audience for this update; see {@link IncidentVisibilityEnum}. */
  visibility: IncidentVisibilityEnum,
  createdAt: z.date(),
  /** Set when the update was edited in place. `null`/absent = never edited. */
  editedAt: z.date().nullable().optional(),
  /**
   * Prior versions of this update, oldest first. Present ONLY for the manager
   * audience (stripped on public / logged-in reads to avoid leaking prior
   * internal content). Absent/empty means no edit history to show.
   */
  editHistory: z.array(IncidentUpdateEditSnapshotSchema).optional(),
  createdBy: z.string().optional(),
  createdByName: z.string().optional(),
});
export type IncidentUpdate = z.infer<typeof IncidentUpdateSchema>;

/**
 * Free-form hotlink attached to an incident (e.g. Jira ticket, runbook).
 */
export const IncidentLinkSchema = z.object({
  id: z.string(),
  incidentId: z.string(),
  label: z.string().nullable(),
  url: z.string(),
  /** Audience for this hotlink; see {@link IncidentVisibilityEnum}. */
  visibility: IncidentVisibilityEnum,
  createdAt: z.date(),
});
export type IncidentLink = z.infer<typeof IncidentLinkSchema>;

export const AddIncidentLinkInputSchema = z.object({
  incidentId: z.string(),
  label: z.string().max(120).optional(),
  url: z.string().url("Must be a valid URL"),
  // Optional at the boundary; the service defaults an omitted value to "public".
  visibility: IncidentVisibilityEnum.optional(),
});
export type AddIncidentLinkInput = z.infer<typeof AddIncidentLinkInputSchema>;

/**
 * Edit an existing hotlink in place. Scoped by `incidentId` in the handler
 * (anti-spoof, mirrors removeLink). Only the provided fields change; omitting a
 * field leaves it unchanged.
 */
export const UpdateIncidentLinkInputSchema = z.object({
  id: z.string(),
  incidentId: z.string(),
  label: z.string().max(120).optional(),
  url: z.string().url("Must be a valid URL").optional(),
  visibility: IncidentVisibilityEnum.optional(),
});
export type UpdateIncidentLinkInput = z.infer<
  typeof UpdateIncidentLinkInputSchema
>;

/**
 * Full incident detail with systems, updates, and hotlinks
 */
export const IncidentDetailSchema = IncidentWithSystemsSchema.extend({
  updates: z.array(IncidentUpdateSchema),
  links: z.array(IncidentLinkSchema),
});
export type IncidentDetail = z.infer<typeof IncidentDetailSchema>;

// Input schemas for mutations
export const CreateIncidentInputSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  severity: IncidentSeverityEnum,
  suppressNotifications: z.boolean().optional().default(false),
  /**
   * Optional health status to force onto the affected systems while the incident
   * is active. Omit or pass `null` to leave derived system health untouched.
   */
  healthOverride: IncidentHealthOverrideEnum.nullable().optional(),
  systemIds: z.array(z.string()).min(1, "At least one system is required"),
  initialMessage: z
    .string()
    .optional()
    .describe("Optional initial status update message"),
  /**
   * Optional owning-team id. When supplied by an authenticated team member, the
   * autoAuthMiddleware create-mode writes a team-scoped ownership grant for the
   * newly created incident. Omitting it (or calling with global-manage) creates
   * the incident without team scoping, exactly as before. Never written to the
   * incident row — the router handler ignores this field before delegating to
   * the service.
   */
  teamId: z.string().optional(),
});
export type CreateIncidentInput = z.infer<typeof CreateIncidentInputSchema>;

export const UpdateIncidentInputSchema = z.object({
  id: z.string(),
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  severity: IncidentSeverityEnum.optional(),
  suppressNotifications: z.boolean().optional(),
  /**
   * Set to a status to force it, or `null` to clear a previously-set override.
   * Omit to leave the current override unchanged (same nullable-optional
   * clearing semantics as `description`).
   */
  healthOverride: IncidentHealthOverrideEnum.nullable().optional(),
  systemIds: z.array(z.string()).min(1).optional(),
});
export type UpdateIncidentInput = z.infer<typeof UpdateIncidentInputSchema>;

export const AddIncidentUpdateInputSchema = z.object({
  incidentId: z.string(),
  message: z.string().min(1, "Message is required"),
  statusChange: IncidentStatusEnum.optional(),
  // Optional at the boundary; the service defaults an omitted value to "public".
  visibility: IncidentVisibilityEnum.optional(),
});
export type AddIncidentUpdateInput = z.infer<
  typeof AddIncidentUpdateInputSchema
>;

/**
 * Edit a published update in place. Only the provided fields change; a
 * `statusChange` edit on the LATEST update (or a `createdAt` re-time that
 * changes which update is latest) re-derives the incident's status
 * (handled server-side). Sets `editedAt` and archives the prior version into
 * `editHistory` when any field actually changes, so the timeline can mark it
 * "edited" and offer a history disclosure.
 */
export const EditIncidentUpdateInputSchema = z.object({
  id: z.string(),
  incidentId: z.string(),
  message: z.string().min(1, "Message is required").optional(),
  statusChange: IncidentStatusEnum.optional(),
  visibility: IncidentVisibilityEnum.optional(),
  /**
   * Optional new published time for the update. Omit to leave it unchanged.
   * Re-timing an update re-derives the incident status (ordering by time), so
   * the header still follows the latest status-bearing update.
   */
  createdAt: z.date().optional(),
});
export type EditIncidentUpdateInput = z.infer<
  typeof EditIncidentUpdateInputSchema
>;

/** Delete a published update. Scoped by `incidentId` in the handler. */
export const DeleteIncidentUpdateInputSchema = z.object({
  id: z.string(),
  incidentId: z.string(),
});
export type DeleteIncidentUpdateInput = z.infer<
  typeof DeleteIncidentUpdateInputSchema
>;

/**
 * Per-id outcome of a bulk incident action (mass delete / mass resolve).
 *
 * - `deleted` / `resolved`: the action succeeded for this incident.
 * - `notFound`: no incident with this id exists (or it vanished mid-batch).
 * - `forbidden`: the caller cannot MANAGE this incident (filtered out by the
 *   `bulkManage` instance-access mode before the handler ran).
 * - `error`: the per-id operation threw; the batch continued past it.
 */
export const BulkIncidentActionStatusEnum = z.enum([
  "deleted",
  "resolved",
  "notFound",
  "forbidden",
  "error",
]);
export type BulkIncidentActionStatus = z.infer<
  typeof BulkIncidentActionStatusEnum
>;

export const BulkIncidentActionResultSchema = z.object({
  id: z.string(),
  status: BulkIncidentActionStatusEnum,
});
export type BulkIncidentActionResult = z.infer<
  typeof BulkIncidentActionResultSchema
>;

/** Input for a bulk incident action: a non-empty set of incident ids. */
export const BulkIncidentIdsInputSchema = z.object({
  ids: z.array(z.string()).min(1, "At least one incident is required"),
});
export type BulkIncidentIdsInput = z.infer<typeof BulkIncidentIdsInputSchema>;

/** Input for bulk resolve: incident ids plus an optional shared message. */
export const BulkResolveIncidentsInputSchema = z.object({
  ids: z.array(z.string()).min(1, "At least one incident is required"),
  message: z.string().optional(),
});
export type BulkResolveIncidentsInput = z.infer<
  typeof BulkResolveIncidentsInputSchema
>;
