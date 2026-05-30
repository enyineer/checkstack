import type { BlobStore } from "./blob-store";

/**
 * Collects every registered {@link BlobStore} (one per store plugin) and
 * resolves the active one by id. Also offers a read-with-fallback used
 * during a storage migration: when the active backend doesn't yet hold a
 * blob, fall back to the other registered backends so script execution
 * never breaks mid-migration.
 */
export interface BlobStoreRegistry {
  register(store: BlobStore): void;
  /** All registered store ids (for the admin backend selector). */
  ids(): string[];
  has(id: string): boolean;
  /** Resolve a specific store by id. Throws if not registered. */
  get(id: string): BlobStore;
  /**
   * Read a blob from `activeBackendId`, falling back across the other
   * registered backends if the active one lacks it. Returns the bytes +
   * the id of the backend that served them, or undefined if none have it.
   */
  readWithFallback(input: {
    integrity: string;
    activeBackendId: string;
  }): Promise<{ bytes: Uint8Array; servedBy: string } | undefined>;
}

export function createBlobStoreRegistry(): BlobStoreRegistry {
  const stores = new Map<string, BlobStore>();

  return {
    register(store) {
      stores.set(store.id, store);
    },

    ids() {
      return [...stores.keys()];
    },

    has(id) {
      return stores.has(id);
    },

    get(id) {
      const store = stores.get(id);
      if (!store) {
        throw new Error(
          `Blob store backend "${id}" is not registered. Available: ${
            [...stores.keys()].join(", ") || "(none)"
          }`,
        );
      }
      return store;
    },

    async readWithFallback({ integrity, activeBackendId }) {
      const active = stores.get(activeBackendId);
      if (active) {
        const bytes = await active.get({ integrity });
        if (bytes !== undefined) {
          return { bytes, servedBy: activeBackendId };
        }
      }
      // Fallback across the rest (migration in flight, partial state).
      for (const [id, store] of stores) {
        if (id === activeBackendId) continue;
        const bytes = await store.get({ integrity });
        if (bytes !== undefined) {
          return { bytes, servedBy: id };
        }
      }
      return;
    },
  };
}
