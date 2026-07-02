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
 * Maintenance update schema - status updates posted to a maintenance
 */
export const MaintenanceUpdateSchema = z.object({
  id: z.string(),
  maintenanceId: z.string(),
  message: z.string(),
  statusChange: MaintenanceStatusEnum.optional(),
  createdAt: z.date(),
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
  createdAt: z.date(),
});
export type MaintenanceLink = z.infer<typeof MaintenanceLinkSchema>;

export const AddMaintenanceLinkInputSchema = z.object({
  maintenanceId: z.string(),
  label: z.string().max(120).optional(),
  url: z.string().url("Must be a valid URL"),
});
export type AddMaintenanceLinkInput = z.infer<
  typeof AddMaintenanceLinkInputSchema
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
});
export type AddMaintenanceUpdateInput = z.infer<
  typeof AddMaintenanceUpdateInputSchema
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
