import { z } from "zod";

// Domain type schemas for catalog entities
// These match the database output types exactly
// JSON serialization will handle Date -> ISO string conversion automatically

export const SystemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  owner: z.string().nullable(),
  status: z.enum(["healthy", "degraded", "unhealthy"]), // Proper enum for type safety
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type System = z.infer<typeof SystemSchema>;

export const GroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  systemIds: z.array(z.string()), // Required field from the service layer
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Group = z.infer<typeof GroupSchema>;

export const ViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  configuration: z.unknown(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type View = z.infer<typeof ViewSchema>;

export const IncidentSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  severity: z.string(),
  systemId: z.string().nullable(),
  groupId: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Incident = z.infer<typeof IncidentSchema>;
