import { isSecretRef } from "@checkstack/gitops-common";

/**
 * Interface for resolving secret names to their decrypted values.
 */
export interface SecretStore {
  resolve: (name: string) => Promise<string>;
}

/**
 * Recursively walks a parsed spec object and resolves any `{ secretRef: "name" }`
 * values by looking them up in the secret store.
 *
 * After resolution, all secretRef objects are replaced with plain strings.
 * This function is called by the reconciliation engine before invoking plugin reconcilers.
 */
export async function resolveSecrets(params: {
  spec: Record<string, unknown>;
  secretStore: SecretStore;
}): Promise<Record<string, unknown>> {
  const { spec, secretStore } = params;
  return resolveValue(spec, secretStore) as Promise<Record<string, unknown>>;
}

async function resolveValue(
  value: unknown,
  secretStore: SecretStore,
): Promise<unknown> {
  if (value === null || value === undefined) {
    return value;
  }

  // Check if this value is a secretRef object
  if (isSecretRef(value)) {
    return secretStore.resolve(value.secretRef);
  }

  // Recurse into arrays
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => resolveValue(item, secretStore)));
  }

  // Recurse into plain objects
  if (typeof value === "object") {
    const resolved: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      resolved[key] = await resolveValue(val, secretStore);
    }
    return resolved;
  }

  // Primitives pass through
  return value;
}
