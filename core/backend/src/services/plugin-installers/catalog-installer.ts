import type {
  PluginInstaller,
  PluginSource,
  FetchedTarball,
  InstalledArtifact,
} from "@checkstack/backend-api";
import { PluginInstallError } from "./plugin-install-error";

/**
 * Stub for the future Checkstack catalog/marketplace.
 *
 * Surfaces in the UI as a "Coming Soon" tab; calling the install endpoint
 * with a `catalog` source returns an explicit not-implemented error.
 */
export class CatalogPluginInstaller implements PluginInstaller {
  async fetchTarball(_source: PluginSource): Promise<FetchedTarball> {
    throw new PluginInstallError(
      "NOT_IMPLEMENTED",
      "The Checkstack plugin catalog isn't available yet. Install via npm, GitHub release, or tarball upload in the meantime.",
    );
  }

  async installFromArtifact(_input: {
    tarball: Uint8Array;
    pluginName: string;
    allowInstallScripts?: boolean;
  }): Promise<InstalledArtifact> {
    throw new PluginInstallError(
      "NOT_IMPLEMENTED",
      "The Checkstack plugin catalog isn't available yet.",
    );
  }
}
