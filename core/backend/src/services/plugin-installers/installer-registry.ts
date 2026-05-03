import type {
  PluginInstaller,
  PluginInstallerRegistry,
  PluginSource,
  FetchedTarball,
  PluginArtifactStore,
} from "@checkstack/backend-api";
import { NpmPluginInstaller } from "./npm-installer";
import { TarballPluginInstaller } from "./tarball-installer";
import { GithubPluginInstaller } from "./github-installer";
import { CatalogPluginInstaller } from "./catalog-installer";

/**
 * Composite registry that routes a `PluginSource` to its installer.
 *
 * One instance is registered against `coreServices.pluginInstallerRegistry`
 * at boot. All plugin install/uninstall flows go through this — the
 * legacy single-method `PluginInstaller` is gone.
 */
export class DefaultPluginInstallerRegistry
  implements PluginInstallerRegistry
{
  private readonly installers: Record<PluginSource["type"], PluginInstaller>;

  constructor({
    runtimeDir,
    artifactStore,
  }: {
    runtimeDir: string;
    artifactStore: PluginArtifactStore;
  }) {
    this.installers = {
      npm: new NpmPluginInstaller(runtimeDir),
      tarball: new TarballPluginInstaller(runtimeDir, artifactStore),
      github: new GithubPluginInstaller(runtimeDir),
      catalog: new CatalogPluginInstaller(),
    };
  }

  forSource(type: PluginSource["type"]): PluginInstaller {
    const installer = this.installers[type];
    if (!installer) {
      throw new Error(`No plugin installer registered for source type '${type}'`);
    }
    return installer;
  }

  fetchTarball(source: PluginSource): Promise<FetchedTarball> {
    return this.forSource(source.type).fetchTarball(source);
  }
}
