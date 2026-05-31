import { z } from "zod";

/**
 * Hook id fired when a secret is created, rotated, or deleted. The actual
 * `Hook` object is created in `@checkstack/secrets-backend` (via
 * `createHook` from `@checkstack/backend-api`); only the id + payload
 * shape live here so consumers can reference them without a backend dep.
 *
 * Consumers (e.g. gitops) subscribe to re-reconcile entities that
 * reference the changed secret.
 */
export const SECRETS_CHANGED_HOOK_ID = "secrets.changed";

export const secretsChangedPayloadSchema = z.object({
  /** Name of the secret that changed. */
  name: z.string(),
  /** What happened to it. */
  change: z.enum(["created", "rotated", "deleted"]),
});

export type SecretsChangedPayload = z.infer<typeof secretsChangedPayloadSchema>;
