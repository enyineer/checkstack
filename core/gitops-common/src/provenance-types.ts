import { z } from "zod";

export const provenanceStatusSchema = z.enum(["synced", "error", "orphaned"]);
export type ProvenanceStatus = z.infer<typeof provenanceStatusSchema>;

export const deletionPolicySchema = z.enum(["orphan", "auto"]);
export type DeletionPolicy = z.infer<typeof deletionPolicySchema>;

export const provenanceSchema = z.object({
  id: z.string(),
  apiVersion: z.string(),
  kind: z.string(),
  entityName: z.string(),
  providerId: z.string(),
  repository: z.string(),
  filePath: z.string(),
  lastSyncHash: z.string(),
  status: provenanceStatusSchema,
  errorMessage: z.string().nullable(),
  lastSyncedAt: z.date(),
  createdAt: z.date(),
});

export type Provenance = z.infer<typeof provenanceSchema>;
