import { z } from "zod";

/**
 * The current Checkstack API version for entity descriptors.
 */
export const CHECKSTACK_API_VERSION = "checkstack.io/v1alpha1";

/**
 * Regex for valid entity names.
 * Must start with a lowercase letter or digit, followed by lowercase letters, digits, or hyphens.
 * Maximum 63 characters (aligned with Backstage/Kubernetes conventions).
 */
const entityNameRegex = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Schema for the entity metadata block.
 * These fields are common to ALL entity kinds.
 */
export const entityMetadataSchema = z.object({
  /** URL-safe unique identifier. Lowercase alphanumeric + hyphens, max 63 chars. */
  name: z
    .string()
    .regex(
      entityNameRegex,
      "Must be lowercase alphanumeric with hyphens, starting with a letter or digit",
    )
    .max(63, "Entity name must not exceed 63 characters"),

  /** Optional human-readable display name. */
  title: z.string().optional(),

  /** Optional description. */
  description: z.string().optional(),

  /** Optional key-value pairs for filtering and organizing. */
  labels: z.record(z.string(), z.string()).optional(),

  /** Optional key-value pairs for machine-readable metadata. */
  annotations: z.record(z.string(), z.string()).optional(),

  /** Optional string tags for categorization. */
  tags: z.array(z.string()).optional(),
});

export type EntityMetadata = z.infer<typeof entityMetadataSchema>;

/**
 * Schema for the base entity envelope.
 * All YAML descriptors must conform to this shape.
 * The `spec` field is validated per-kind by the Entity Kind Registry.
 */
export const entityEnvelopeSchema = z.object({
  /** Versioned API identifier (e.g., "checkstack.io/v1alpha1"). */
  apiVersion: z
    .string()
    .regex(
      /^[\w.-]+\/v[\w.]+$/,
      "Must follow format: domain/version (e.g., checkstack.io/v1alpha1)",
    ),

  /** The entity kind (e.g., "System", "Healthcheck"). Must be registered. */
  kind: z.string().min(1, "Kind must not be empty"),

  /** Common metadata fields. */
  metadata: entityMetadataSchema,

  /** Kind-specific specification. Validated by the kind's registered schema. */
  spec: z.record(z.string(), z.unknown()).optional(),
});

export type EntityEnvelope = z.infer<typeof entityEnvelopeSchema>;
