import { z } from "zod";

/**
 * Maintenance status enum values
 */
export const MaintenanceStatusEnum = z.enum([
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
]);
export type MaintenanceStatus = z.infer<typeof MaintenanceStatusEnum>;

/**
 * Audience for a maintenance update or hotlink.
 *
 * - `public`: visible to everyone, including anonymous visitors and the public
 *   status page.
 * - `logged_in`: visible only to authenticated users (hidden from anonymous
 *   reads and the public status-page projection).
 * - `internal`: an operator-only note, visible only to maintenance managers.
 *
 * Filtering is enforced SERVER-SIDE on the read path (never CSS).
 */
export const MaintenanceVisibilityEnum = z.enum([
  "public",
  "logged_in",
  "internal",
]);
export type MaintenanceVisibility = z.infer<typeof MaintenanceVisibilityEnum>;

/**
 * Core maintenance entity schema
 */
export const MaintenanceSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  suppressNotifications: z.boolean(),
  status: MaintenanceStatusEnum,
  startAt: z.date(),
  endAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Maintenance = z.infer<typeof MaintenanceSchema>;

/**
 * Maintenance with related systems
 */
export const MaintenanceWithSystemsSchema = MaintenanceSchema.extend({
  systemIds: z.array(z.string()),
});
export type MaintenanceWithSystems = z.infer<
  typeof MaintenanceWithSystemsSchema
>;

/**
 * A prior version of a maintenance update, archived when the update is edited in
 * place. Captures every field an edit can change PLUS the published time
 * (`createdAt`) that version carried, so the timeline can show a GitHub-style
 * "history of edits". Timestamps are ISO strings because the array is persisted
 * as a `jsonb` column and round-trips through JSON.
 *
 * This is MANAGER-FACING detail: a prior version may have been `internal` before
 * being made `public`, so the read path only attaches `editHistory` for the
 * manager audience (see `maintenance-backend/read-visibility`). Never ship it to
 * a public / logged-in reader, or prior internal content would leak.
 */
export const MaintenanceUpdateEditSnapshotSchema = z.object({
  message: z.string(),
  statusChange: MaintenanceStatusEnum.optional(),
  visibility: MaintenanceVisibilityEnum,
  /** The published time this version carried before the edit (ISO string). */
  createdAt: z.string(),
  /** When this version was superseded, i.e. the edit timestamp (ISO string). */
  editedAt: z.string(),
});
export type MaintenanceUpdateEditSnapshot = z.infer<
  typeof MaintenanceUpdateEditSnapshotSchema
>;

/**
 * Maintenance update schema - status updates posted to a maintenance
 */
export const MaintenanceUpdateSchema = z.object({
  id: z.string(),
  maintenanceId: z.string(),
  message: z.string(),
  statusChange: MaintenanceStatusEnum.optional(),
  /** Audience for this update; see {@link MaintenanceVisibilityEnum}. */
  visibility: MaintenanceVisibilityEnum,
  createdAt: z.date(),
  /** Set when the update was edited in place. `null`/absent = never edited. */
  editedAt: z.date().nullable().optional(),
  /**
   * Prior versions of this update, oldest first. Present ONLY for the manager
   * audience (stripped on public / logged-in reads to avoid leaking prior
   * internal content). Absent/empty means no edit history to show.
   */
  editHistory: z.array(MaintenanceUpdateEditSnapshotSchema).optional(),
  createdBy: z.string().optional(),
  createdByName: z.string().optional(),
});
export type MaintenanceUpdate = z.infer<typeof MaintenanceUpdateSchema>;

/**
 * Free-form hotlink attached to a maintenance (e.g. change ticket, runbook).
 */
export const MaintenanceLinkSchema = z.object({
  id: z.string(),
  maintenanceId: z.string(),
  label: z.string().nullable(),
  url: z.string(),
  /** Audience for this hotlink; see {@link MaintenanceVisibilityEnum}. */
  visibility: MaintenanceVisibilityEnum,
  createdAt: z.date(),
});
export type MaintenanceLink = z.infer<typeof MaintenanceLinkSchema>;

export const AddMaintenanceLinkInputSchema = z.object({
  maintenanceId: z.string(),
  label: z.string().max(120).optional(),
  url: z.string().url("Must be a valid URL"),
  // Optional at the boundary; the service defaults an omitted value to "public".
  visibility: MaintenanceVisibilityEnum.optional(),
});
export type AddMaintenanceLinkInput = z.infer<
  typeof AddMaintenanceLinkInputSchema
>;

/**
 * Edit an existing hotlink in place. Scoped by `maintenanceId` in the handler
 * (anti-spoof, mirrors removeLink). Only the provided fields change; omitting a
 * field leaves it unchanged.
 */
export const UpdateMaintenanceLinkInputSchema = z.object({
  id: z.string(),
  maintenanceId: z.string(),
  label: z.string().max(120).optional(),
  url: z.string().url("Must be a valid URL").optional(),
  visibility: MaintenanceVisibilityEnum.optional(),
});
export type UpdateMaintenanceLinkInput = z.infer<
  typeof UpdateMaintenanceLinkInputSchema
>;

/**
 * Full maintenance detail with systems, updates, and hotlinks
 */
export const MaintenanceDetailSchema = MaintenanceWithSystemsSchema.extend({
  updates: z.array(MaintenanceUpdateSchema),
  links: z.array(MaintenanceLinkSchema),
});
export type MaintenanceDetail = z.infer<typeof MaintenanceDetailSchema>;

// Input schemas for mutations
export const CreateMaintenanceInputSchema = z
  .object({
    title: z.string().min(1, "Title is required"),
    description: z.string().optional(),
    suppressNotifications: z.boolean().optional().default(false),
    startAt: z.date(),
    endAt: z.date(),
    systemIds: z.array(z.string()).min(1, "At least one system is required"),
    /** Optional owning-team id. Consumed by autoAuthMiddleware (create-mode team
     * ownership); ignored by the backend handler and never written to the DB row. */
    teamId: z.string().optional(),
  })
  .refine((data) => data.endAt > data.startAt, {
    message: "End date must be after start date",
    path: ["endAt"],
  });
export type CreateMaintenanceInput = z.infer<
  typeof CreateMaintenanceInputSchema
>;

export const UpdateMaintenanceInputSchema = z.object({
  id: z.string(),
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  suppressNotifications: z.boolean().optional(),
  startAt: z.date().optional(),
  endAt: z.date().optional(),
  systemIds: z.array(z.string()).min(1).optional(),
});
export type UpdateMaintenanceInput = z.infer<
  typeof UpdateMaintenanceInputSchema
>;

export const AddMaintenanceUpdateInputSchema = z.object({
  maintenanceId: z.string(),
  message: z.string().min(1, "Message is required"),
  statusChange: MaintenanceStatusEnum.optional(),
  // Optional at the boundary; the service defaults an omitted value to "public".
  visibility: MaintenanceVisibilityEnum.optional(),
});
export type AddMaintenanceUpdateInput = z.infer<
  typeof AddMaintenanceUpdateInputSchema
>;

/**
 * Edit a published update in place. Only the provided fields change; a
 * `statusChange` edit on the LATEST update (or a `createdAt` re-time that
 * changes which update is latest) re-derives the maintenance status
 * (handled server-side). Sets `editedAt` and archives the prior version into
 * `editHistory` when any field actually changes, so the timeline can mark it
 * "edited" and offer a history disclosure.
 */
export const EditMaintenanceUpdateInputSchema = z.object({
  id: z.string(),
  maintenanceId: z.string(),
  message: z.string().min(1, "Message is required").optional(),
  statusChange: MaintenanceStatusEnum.optional(),
  visibility: MaintenanceVisibilityEnum.optional(),
  /**
   * Optional new published time for the update. Omit to leave it unchanged.
   * Re-timing an update re-derives the maintenance status (ordering by time),
   * so the header still follows the latest status-bearing update.
   */
  createdAt: z.date().optional(),
});
export type EditMaintenanceUpdateInput = z.infer<
  typeof EditMaintenanceUpdateInputSchema
>;

/** Delete a published update. Scoped by `maintenanceId` in the handler. */
export const DeleteMaintenanceUpdateInputSchema = z.object({
  id: z.string(),
  maintenanceId: z.string(),
});
export type DeleteMaintenanceUpdateInput = z.infer<
  typeof DeleteMaintenanceUpdateInputSchema
>;

/**
 * Per-id outcome of a bulk maintenance action (mass delete / mass complete).
 *
 * The "resolve"-equivalent for a maintenance is CLOSE (status → `completed`),
 * so mass-resolve reports `completed` on success.
 *
 * - `deleted` / `completed`: the action succeeded for this maintenance.
 * - `notFound`: no maintenance with this id exists (or it vanished mid-batch).
 * - `forbidden`: the caller cannot MANAGE this maintenance (filtered out by the
 *   `bulkManage` instance-access mode before the handler ran).
 * - `error`: the per-id operation threw; the batch continued past it.
 */
export const BulkMaintenanceActionStatusEnum = z.enum([
  "deleted",
  "completed",
  "notFound",
  "forbidden",
  "error",
]);
export type BulkMaintenanceActionStatus = z.infer<
  typeof BulkMaintenanceActionStatusEnum
>;

export const BulkMaintenanceActionResultSchema = z.object({
  id: z.string(),
  status: BulkMaintenanceActionStatusEnum,
});
export type BulkMaintenanceActionResult = z.infer<
  typeof BulkMaintenanceActionResultSchema
>;

/** Input for a bulk maintenance action: a non-empty set of maintenance ids. */
export const BulkMaintenanceIdsInputSchema = z.object({
  ids: z.array(z.string()).min(1, "At least one maintenance is required"),
});
export type BulkMaintenanceIdsInput = z.infer<
  typeof BulkMaintenanceIdsInputSchema
>;

/** Input for bulk close: maintenance ids plus an optional shared message. */
export const BulkCloseMaintenancesInputSchema = z.object({
  ids: z.array(z.string()).min(1, "At least one maintenance is required"),
  message: z.string().optional(),
});
export type BulkCloseMaintenancesInput = z.infer<
  typeof BulkCloseMaintenancesInputSchema
>;
