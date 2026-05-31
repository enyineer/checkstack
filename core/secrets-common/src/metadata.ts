import { z } from "zod";

/**
 * Public metadata for a secret. NEVER carries the value — only the name,
 * a human description, provenance, and `hasValue` (whether a value is
 * currently stored). This is the only shape that crosses to a browser.
 */
export const secretMetadataSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  /** Whether a value is currently stored for this secret. */
  hasValue: z.boolean(),
  /** Backend id that owns this secret (e.g. "local", "vault"). */
  backend: z.string(),
  createdBy: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type SecretMetadata = z.infer<typeof secretMetadataSchema>;
