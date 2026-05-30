import { createHook } from "@checkstack/backend-api";
import {
  SECRETS_CHANGED_HOOK_ID,
  type SecretsChangedPayload,
} from "@checkstack/secrets-common";

/**
 * Backend hook fired when a secret is created, rotated, or deleted.
 * Consumers (e.g. gitops) subscribe to re-reconcile entities that
 * reference the changed secret.
 */
export const secretsChangedHook = createHook<SecretsChangedPayload>(
  SECRETS_CHANGED_HOOK_ID,
);
