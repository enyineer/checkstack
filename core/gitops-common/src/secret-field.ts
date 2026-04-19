import { z } from "zod";

/**
 * Schema for a secret reference object.
 * Used in YAML descriptors to reference secrets stored in the Checkstack secret store.
 */
export const secretRefSchema = z.object({
  secretRef: z.string().min(1, "Secret reference name must not be empty"),
});

export type SecretRef = z.infer<typeof secretRefSchema>;

/**
 * Type guard to check if a value is a SecretRef object.
 */
export function isSecretRef(value: unknown): value is SecretRef {
  if (value === null || value === undefined || typeof value !== "object") {
    return false;
  }
  return (
    "secretRef" in value &&
    typeof (value as SecretRef).secretRef === "string"
  );
}

/**
 * Creates a Zod schema for fields that accept either a plain string or a secret reference.
 *
 * In YAML descriptors, users can write either:
 * ```yaml
 * password: "dev-password"              # plain string
 * password:
 *   secretRef: production-db-creds      # reference to secret store
 * ```
 *
 * The GitOps reconciliation engine resolves all secretRef values before calling
 * plugin reconcilers, so plugins always receive plain strings.
 */
export function secretField() {
  return z.union([z.string(), secretRefSchema]);
}

/**
 * The resolved type of a secret field is always a string.
 * After the reconciliation engine resolves secretRefs, all values are plain strings.
 */
export type ResolvedSecretField = string;
