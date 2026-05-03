import {
  
  
  
  type InstallPackageMetadata,
  type PluginBundleManifest,
  type PluginSource,
} from "@checkstack/common";

// ─────────────────────────────────────────────────────────────────────────────
// Runtime-only types for the plugin installer pipeline.
//
// `PluginSource` (the discriminated union itself) lives in `@checkstack/common`
// because it must be referenceable from contracts. The interfaces below are
// implemented by services running on the backend, so they live here.
// ─────────────────────────────────────────────────────────────────────────────

export interface FetchedTarball {
  tarball: Uint8Array;
  packageJson: InstallPackageMetadata;
  /**
   * Set when the fetched tarball is a bundle (outer `.tgz` containing
   * sibling tarballs and a `bundle.json`). The siblings array contains
   * already-extracted per-package tarballs.
   */
  bundle?: {
    manifest: PluginBundleManifest;
    siblings: Array<{
      tarball: Uint8Array;
      packageJson: InstallPackageMetadata;
    }>;
  };
}

export interface InstalledArtifact {
  /** The npm package name (matches `packageJson.name`) */
  name: string;
  /** Absolute path to the installed plugin under the runtime dir */
  path: string;
  /** The installed version */
  version: string;
}

/**
 * Per-source installer.
 *
 * Two-phase by design:
 *   1. fetchTarball(source)         — pulls bytes; does NOT install anything.
 *                                     Originator runs this once, persists the
 *                                     bytes to plugin_artifacts, then broadcasts.
 *   2. installFromArtifact({ ... }) — extracts the tarball into the plugin
 *                                     runtime dir via `bun install ... --no-save
 *                                     --ignore-scripts` (unless allowInstallScripts).
 *                                     Every instance runs this when handling
 *                                     the broadcast.
 */
export interface PluginInstaller {
  fetchTarball(source: PluginSource): Promise<FetchedTarball>;
  installFromArtifact(input: {
    tarball: Uint8Array;
    pluginName: string;
    allowInstallScripts?: boolean;
  }): Promise<InstalledArtifact>;
}

/**
 * Registry of per-source installers. Indexed by `PluginSource["type"]`.
 */
export interface PluginInstallerRegistry {
  forSource(type: PluginSource["type"]): PluginInstaller;
  fetchTarball(source: PluginSource): Promise<FetchedTarball>;
}

// Re-export the source-related schemas/types from `@checkstack/common` so
// backend code only needs one import path.

export type {
  NpmPluginSource,
  TarballPluginSource,
  GithubPluginSource,
  CatalogPluginSource, PluginSource, InstallPackageMetadata, PluginBundleManifest,
} from "@checkstack/common";

export {installPackageMetadataSchema, pluginBundleManifestSchema, pluginSourceSchema} from "@checkstack/common";