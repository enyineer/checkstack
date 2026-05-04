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
  /** Plugin-specific entity ID (e.g., catalog system UUID). Set by the reconciler engine. */
  entityId: z.string(),
  providerId: z.string(),
  repository: z.string(),
  filePath: z.string(),
  /**
   * Browsable web URL pointing to the entity's defining file in its source
   * provider, derived from the provider type, baseUrl, repository and filePath.
   * Null when the URL cannot be safely derived (unknown baseUrl shape, etc.).
   */
  sourceUrl: z.string().nullable(),
  lastSyncHash: z.string(),
  status: provenanceStatusSchema,
  errorMessage: z.string().nullable(),
  /** Warnings about unresolved secret templates in non-secret fields. */
  warnings: z.array(z.string()),
  lastSyncedAt: z.date(),
  createdAt: z.date(),
});

export type Provenance = z.infer<typeof provenanceSchema>;
