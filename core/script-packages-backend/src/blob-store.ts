import { createExtensionPoint } from "@checkstack/backend-api";
import type { PluginMetadata } from "@checkstack/common";

/**
 * Pluggable, content-addressed blob persistence for script-package
 * artifacts. Blobs are keyed by their integrity hash (the npm tarball /
 * Bun-cache entry per `name@version`), so the integrity is the stable
 * identity across backends - only the locator differs.
 *
 * Two built-ins ship as plugins: `script-packages-store-postgres` (the
 * default, Postgres large-objects, zero extra infra) and
 * `script-packages-store-s3` (preferred when configured). Adding a third
 * later is just another plugin implementing this interface; no schema
 * change.
 *
 * Implementations MUST be content-addressed and idempotent: `put` of an
 * already-present integrity is a no-op (or overwrite with identical bytes).
 */
export interface BlobStore {
  /** Stable backend id recorded in `script_package_blob.backend`. */
  readonly id: string;

  /** Store the (already-compressed) bytes for `integrity`. Idempotent. */
  put(input: { integrity: string; bytes: Uint8Array }): Promise<void>;

  /** Fetch the bytes for `integrity`, or undefined if this backend lacks it. */
  get(input: { integrity: string }): Promise<Uint8Array | undefined>;

  /** Whether this backend holds `integrity`. */
  has(input: { integrity: string }): Promise<boolean>;

  /** Delete the blob for `integrity` (GC / post-migration cleanup). Idempotent. */
  delete(input: { integrity: string }): Promise<void>;

  /** Every integrity this backend currently holds (for migration / GC). */
  list(): Promise<string[]>;
}

/**
 * Extension point a blob-store plugin registers its implementation with.
 * The active backend is selected via `script_package_storage_config`; the
 * backend resolves the registered store by id.
 */
export interface BlobStoreExtensionPoint {
  registerBlobStore(store: BlobStore, metadata: PluginMetadata): void;
}

export const blobStoreExtensionPoint =
  createExtensionPoint<BlobStoreExtensionPoint>(
    "script-packages.blobStoreExtensionPoint",
  );
