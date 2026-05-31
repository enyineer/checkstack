import {
  isInternalSecretName,
  MIN_MASKABLE_LENGTH,
  type SecretMetadata,
} from "@checkstack/secrets-common";
import type { Logger } from "@checkstack/backend-api";
import type { SecretBackend } from "./secret-backend";

/**
 * Cross-plugin secret administration service (exposed via
 * `secretAdminRef`). Lets a consumer plugin manage secrets through the
 * active backend so there is a SINGLE source of truth — e.g. gitops
 * delegates its legacy secret-management RPCs here instead of writing its
 * own table.
 *
 * `list` returns metadata only (never values). `setSecret` is write-only.
 * No method returns a value.
 */
export interface SecretAdminService {
  list(): Promise<SecretMetadata[]>;
  setSecret(input: {
    name: string;
    value: string;
    description?: string;
    createdBy?: string;
  }): Promise<{ created: boolean }>;
  deleteSecret(input: { name: string }): Promise<void>;
}

export function createSecretAdminService({
  getActiveBackend,
  onChanged,
  logger,
}: {
  getActiveBackend: () => Promise<SecretBackend>;
  onChanged: (input: {
    name: string;
    change: "created" | "rotated" | "deleted";
  }) => Promise<void>;
  /**
   * Optional logger so `setSecret` can warn when a value is too short to be
   * auto-redacted (see L1 below). Optional so existing call sites / tests
   * that don't pass one degrade silently.
   */
  logger?: Logger;
}): SecretAdminService {
  return {
    async list() {
      const backend = await getActiveBackend();
      const all = await backend.list();
      // Hide platform-internal secrets (registry token, connection creds)
      // from the user-facing list — they aren't user-managed named secrets.
      return all.filter((m) => !isInternalSecretName(m.name));
    },

    async setSecret({ name, value, description, createdBy }) {
      const backend = await getActiveBackend();
      if (!backend.set) {
        throw new Error(
          `Backend "${backend.id}" is read-only; manage secrets in the external store.`,
        );
      }
      // Values below MIN_MASKABLE_LENGTH can't be auto-redacted by the
      // by-value masker (they'd over-mask coincidental substrings of normal
      // output). Don't silently change the threshold — warn so the operator
      // knows this secret won't be scrubbed from run logs / errors if it
      // ever surfaces. (Length only; never echo the value.)
      if (value.length < MIN_MASKABLE_LENGTH) {
        logger?.warn(
          `Secret "${name}" is ${value.length} character(s) long; values shorter than ${MIN_MASKABLE_LENGTH} cannot be auto-redacted from logs or error output. Consider a longer value.`,
        );
      }
      const existing = await backend.list();
      const created = !existing.some((m) => m.name === name);
      await backend.set({ name, value, description, createdBy });
      await onChanged({ name, change: created ? "created" : "rotated" });
      return { created };
    },

    async deleteSecret({ name }) {
      const backend = await getActiveBackend();
      if (!backend.delete) {
        throw new Error(
          `Backend "${backend.id}" is read-only; manage secrets in the external store.`,
        );
      }
      await backend.delete({ name });
      await onChanged({ name, change: "deleted" });
    },
  };
}
