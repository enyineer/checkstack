import type {
  PluginInstaller,
  PluginSource,
  FetchedTarball,
  InstalledArtifact,
  PluginArtifactStore,
} from "@checkstack/backend-api";
import { extractPackageJson, tryExtractBundle } from "./tarball-utils";
import { installFromArtifact } from "./install-from-tarball";
import { extractErrorMessage } from "@checkstack/common";
import { PluginInstallError } from "./plugin-install-error";

/**
 * "Filesystem" / direct-upload installer.
 *
 * The tarball bytes are uploaded by the user via a multipart REST endpoint,
 * temporarily persisted to `plugin_artifacts` (artifactId surfaces in the
 * source), then this installer just resolves them by id.
 */
export class TarballPluginInstaller implements PluginInstaller {
  constructor(
    private readonly runtimeDir: string,
    private readonly artifactStore: PluginArtifactStore,
  ) {}

  async fetchTarball(source: PluginSource): Promise<FetchedTarball> {
    if (source.type !== "tarball") {
      throw new Error(
        `TarballPluginInstaller cannot handle source type '${source.type}'`,
      );
    }

    const stored = await this.artifactStore.fetchById(source.artifactId);
    if (!stored) {
      throw new PluginInstallError(
        "NOT_FOUND",
        `No uploaded tarball found with id '${source.artifactId}'. ` +
          `It may have been pruned or the upload did not complete — try uploading again.`,
      );
    }

    const bundle = await tryExtractBundle(stored.tarball);
    if (bundle) {
      const primary = bundle.siblings.find(
        (s) => s.packageJson.name === bundle.manifest.primary,
      );
      if (!primary) {
        throw new PluginInstallError(
          "VALIDATION_FAILED",
          `Bundle manifest names primary '${bundle.manifest.primary}' but no matching sibling tarball was found in the uploaded archive.`,
        );
      }
      // `tarball` is the primary's INNER package tarball (not the outer bundle
      // archive): it's what gets persisted as the primary's artifact and what
      // the runtime installs, so it must be a plain `package/package.json`
      // tarball. The outer bundle is exposed via `bundle` for sibling
      // resolution only.
      return {
        tarball: primary.tarball,
        packageJson: primary.packageJson,
        bundle,
      };
    }

    let packageJson;
    try {
      packageJson = await extractPackageJson(stored.tarball);
    } catch (error) {
      throw new PluginInstallError(
        "VALIDATION_FAILED",
        `Uploaded tarball is not a valid Checkstack plugin: ${extractErrorMessage(error)}`,
      );
    }
    return { tarball: stored.tarball, packageJson };
  }

  async installFromArtifact(input: {
    tarball: Uint8Array;
    pluginName: string;
    allowInstallScripts?: boolean;
  }): Promise<InstalledArtifact> {
    return installFromArtifact({ ...input, runtimeDir: this.runtimeDir });
  }
}
