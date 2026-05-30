import type { SecretMetadata } from "@checkstack/secrets-common";
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
}: {
  getActiveBackend: () => Promise<SecretBackend>;
  onChanged: (input: {
    name: string;
    change: "created" | "rotated" | "deleted";
  }) => Promise<void>;
}): SecretAdminService {
  return {
    async list() {
      const backend = await getActiveBackend();
      return backend.list();
    },

    async setSecret({ name, value, description, createdBy }) {
      const backend = await getActiveBackend();
      if (!backend.set) {
        throw new Error(
          `Backend "${backend.id}" is read-only; manage secrets in the external store.`,
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
