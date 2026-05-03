import type {
  PluginInstallerRegistry,
  PluginSource,
  FetchedTarball,
  NpmPluginSource,
} from "@checkstack/backend-api";

/**
 * Given a `PluginSource`, fetch the primary tarball and recursively resolve
 * any bundle siblings into a single normalized list.
 *
 * - npm: bundle siblings are *separate* npm packages; for each, we issue a
 *   second `fetchTarball` call against the same registry.
 * - tarball / github: bundle siblings are *inline* in the outer tarball
 *   (per the `bundle.json` manifest); the per-source installer already
 *   extracted them.
 *
 * Returns the primary first, then siblings in declared order.
 */
export async function resolveBundle({
  source,
  installerRegistry,
}: {
  source: PluginSource;
  installerRegistry: PluginInstallerRegistry;
}): Promise<{
  primary: FetchedTarball;
  packages: FetchedTarball[];
  bundleId?: string;
}> {
  const primary = await installerRegistry.fetchTarball(source);
  const packages: FetchedTarball[] = [primary];

  // Inline bundle (tarball / github)
  if (primary.bundle) {
    for (const sib of primary.bundle.siblings) {
      if (sib.packageJson.name === primary.packageJson.name) continue;
      packages.push({ tarball: sib.tarball, packageJson: sib.packageJson });
    }
    return { primary, packages };
  }

  // Cross-package bundle for npm: declared via primary's checkstack.bundle
  const declared = primary.packageJson.checkstack.bundle;
  if (declared && declared.length > 0) {
    if (source.type !== "npm") {
      // Already-inline bundles are handled above; if a non-npm source
      // declared `checkstack.bundle` without inlining, refuse — the
      // expectation is the pack CLI produces a bundle tarball.
      throw new Error(
        `Plugin ${primary.packageJson.name} declares 'checkstack.bundle' but the source ` +
          `(${source.type}) did not ship sibling tarballs. Use the GitHub release / tarball ` +
          `source with a --bundle-mode tarball, or remove 'checkstack.bundle'.`,
      );
    }
    for (const siblingName of declared) {
      const siblingSource: NpmPluginSource = {
        type: "npm",
        packageName: siblingName,
        // Pin sibling version to primary's exact version — bundles are
        // released atomically and identical-versioned by convention.
        version: primary.packageJson.version,
        registry: source.registry,
      };
      const fetched = await installerRegistry.fetchTarball(siblingSource);
      if (fetched.bundle) {
        throw new Error(
          `Sibling '${siblingName}' itself ships a bundle — bundles cannot nest.`,
        );
      }
      packages.push(fetched);
    }
  }

  return { primary, packages };
}
