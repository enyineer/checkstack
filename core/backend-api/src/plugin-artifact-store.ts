/**
 * Persistent storage for plugin tarballs.
 *
 * Implementations must be **shared across all instances** so that a freshly
 * spun-up replica can recover any plugin that was installed at runtime
 * without re-fetching from the original source. The default implementation
 * uses a Postgres `plugin_artifacts` table (bytea); an S3 implementation
 * can drop in via env config later.
 *
 * Lifecycle:
 *   1. Originator's install handler calls `store(...)` after fetching the
 *      tarball from the source. This commits in the same DB transaction
 *      as the `plugins` row insert.
 *   2. Every instance handling the install broadcast (incl. originator)
 *      calls `fetch(...)` to get the tarball bytes, then runs `bun install`.
 *   3. On uninstall, originator calls `delete(...)` to drop the row.
 */
export interface PluginArtifactStore {
  store(input: {
    pluginName: string;
    version: string;
    /** `null` for single-package installs; `string` for bundle siblings. */
    bundleId?: string | null;
    tarball: Uint8Array;
  }): Promise<{ artifactId: string; contentHash: string }>;

  /**
   * Fetch by `(pluginName, version)`. Returns `undefined` if not present
   * (e.g. the artifact has been pruned but the `plugins` row still exists —
   * the caller is expected to fall back to refetching from the original
   * `PluginSource`).
   */
  fetch(input: {
    pluginName: string;
    version: string;
  }): Promise<{ tarball: Uint8Array; contentHash: string } | undefined>;

  fetchById(artifactId: string): Promise<
    | {
        tarball: Uint8Array;
        contentHash: string;
        pluginName: string;
        version: string;
      }
    | undefined
  >;

  /** Delete artifacts for a plugin (all versions). Used on uninstall. */
  delete(input: { pluginName: string }): Promise<void>;

  /** Delete artifacts for a whole bundle. */
  deleteByBundle(input: { bundleId: string }): Promise<void>;

  /** Hard cap (in bytes) the store will accept. Used for UI feedback. */
  readonly maxArtifactSize: number;
}
