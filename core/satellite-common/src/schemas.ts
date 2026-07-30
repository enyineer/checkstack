import { z } from "zod";
import { HEARTBEAT_INTERVAL_MS } from "./constants";

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
  /**
   * Capabilities the satellite last advertised (e.g. "telemetry", "scrape").
   * Defaults to an empty array for a satellite that never advertised any, so
   * older records / version-skewed agents surface as "no capabilities".
   */
  capabilities: z.array(z.string()).default([]),
  lastHeartbeatAt: z.date().optional(),
  /**
   * This satellite's own offline tolerance, in milliseconds. Absent means the
   * platform default ({@link OFFLINE_THRESHOLD_MS}) applies.
   */
  offlineThresholdMs: z.number().int().positive().optional(),
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
 * A satellite's offline tolerance, in milliseconds.
 *
 * Bounded on BOTH ends deliberately. Below one heartbeat interval a satellite
 * would be reported offline between two perfectly healthy heartbeats, which is
 * a permanent false alarm rather than a tight setting; above 24 hours the
 * satellite has effectively opted out of liveness reporting altogether.
 */
export const OfflineThresholdMsSchema = z
  .number()
  .int()
  .min(HEARTBEAT_INTERVAL_MS, "Must be at least one heartbeat interval")
  .max(24 * 60 * 60 * 1000, "Must be 24 hours or less");

/**
 * Input schema for creating a new satellite.
 */
export const CreateSatelliteSchema = z.object({
  name: z.string().min(1, "Name is required"),
  region: z.string().min(1, "Region is required"),
  tags: z.record(z.string(), z.string()).default({}),
  /**
   * Optional offline tolerance override. Omit to follow the platform default,
   * which is what a satellite on a reliable link should do.
   */
  offlineThresholdMs: OfflineThresholdMsSchema.optional(),
});

export type CreateSatellite = z.infer<typeof CreateSatelliteSchema>;
