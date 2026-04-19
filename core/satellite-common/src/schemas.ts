import { z } from "zod";

// =============================================================================
// SATELLITE ENTITY SCHEMAS
// =============================================================================

/**
 * Satellite status derived from lastHeartbeatAt vs OFFLINE_THRESHOLD_MS.
 */
export const SatelliteStatusSchema = z.enum(["online", "offline"]);

export type SatelliteStatus = z.infer<typeof SatelliteStatusSchema>;

/**
 * Full satellite record as stored in the database.
 * tokenHash is intentionally excluded from the schema —
 * it should never leave the backend.
 */
export const SatelliteSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  region: z.string(),
  tags: z.record(z.string(), z.string()),
  lastHeartbeatAt: z.date().optional(),
  version: z.string().optional(),
  createdAt: z.date(),
});

export type Satellite = z.infer<typeof SatelliteSchema>;

/**
 * Satellite with computed online/offline status.
 * Used in API responses — the status is derived from lastHeartbeatAt.
 */
export const SatelliteWithStatusSchema = SatelliteSchema.extend({
  status: SatelliteStatusSchema,
});

export type SatelliteWithStatus = z.infer<typeof SatelliteWithStatusSchema>;

/**
 * Input schema for creating a new satellite.
 */
export const CreateSatelliteSchema = z.object({
  name: z.string().min(1, "Name is required"),
  region: z.string().min(1, "Region is required"),
  tags: z.record(z.string(), z.string()).default({}),
});

export type CreateSatellite = z.infer<typeof CreateSatelliteSchema>;
