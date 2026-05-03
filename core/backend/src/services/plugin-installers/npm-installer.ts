import type {
  PluginInstaller,
  PluginSource,
  FetchedTarball,
  InstalledArtifact,
} from "@checkstack/backend-api";
import {
  extractPackageJson,
  tryExtractBundle,
  MAX_TARBALL_SIZE_BYTES,
} from "./tarball-utils";
import { installFromArtifact } from "./install-from-tarball";
import { rootLogger } from "../../logger";
import { extractErrorMessage } from "@checkstack/common";
import { PluginInstallError } from "./plugin-install-error";

const DEFAULT_REGISTRY = "https://registry.npmjs.org";

/**
 * Fetch a plugin tarball directly from an npm registry.
 *
 * No on-disk install happens here — we hit the registry's metadata API to
 * resolve `dist.tarball`, then download bytes to memory. The originator
 * uploads those bytes to `plugin_artifacts`; receiving instances install
 * from there.
 */
export class NpmPluginInstaller implements PluginInstaller {
  constructor(private readonly runtimeDir: string) {}

  async fetchTarball(source: PluginSource): Promise<FetchedTarball> {
    if (source.type !== "npm") {
      throw new Error(
        `NpmPluginInstaller cannot handle source type '${source.type}'`,
      );
    }

    const registry = (source.registry || DEFAULT_REGISTRY).replace(/\/$/, "");
    const versionPath = source.version ? `/${source.version}` : "/latest";
    const metaUrl = `${registry}/${encodeNpmName(source.packageName)}${versionPath}`;
    const versionLabel = source.version ?? "latest";

    rootLogger.info(`📦 Resolving npm metadata: ${metaUrl}`);
    let metaResp: Response;
    try {
      metaResp = await fetch(metaUrl);
    } catch (error) {
      throw new PluginInstallError(
        "BAD_GATEWAY",
        `Could not reach npm registry at ${registry}: ${extractErrorMessage(error)}`,
      );
    }
    if (!metaResp.ok) {
      if (metaResp.status === 404) {
        throw new PluginInstallError(
          "NOT_FOUND",
          `Package '${source.packageName}@${versionLabel}' not found on the npm registry${
            source.registry ? ` at ${source.registry}` : ""
          }.`,
        );
      }
      if (metaResp.status === 401 || metaResp.status === 403) {
        throw new PluginInstallError(
          metaResp.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
          `Access to '${source.packageName}' on ${registry} was rejected (HTTP ${metaResp.status}). ` +
            `If this is a private registry, configure auth on the platform.`,
        );
      }
      throw new PluginInstallError(
        "BAD_GATEWAY",
        `npm registry returned HTTP ${metaResp.status} for ${source.packageName}@${versionLabel}.`,
      );
    }
    const meta = (await metaResp.json()) as {
      name: string;
      version: string;
      dist?: { tarball?: string };
    };

    const tarballUrl = meta.dist?.tarball;
    if (!tarballUrl) {
      throw new PluginInstallError(
        "BAD_GATEWAY",
        `npm metadata for '${source.packageName}@${versionLabel}' did not include a download URL (dist.tarball missing).`,
      );
    }

    rootLogger.info(`📦 Downloading tarball: ${tarballUrl}`);
    let tarResp: Response;
    try {
      tarResp = await fetch(tarballUrl);
    } catch (error) {
      throw new PluginInstallError(
        "BAD_GATEWAY",
        `Could not download tarball from ${tarballUrl}: ${extractErrorMessage(error)}`,
      );
    }
    if (!tarResp.ok) {
      throw new PluginInstallError(
        "BAD_GATEWAY",
        `Tarball download for '${source.packageName}@${versionLabel}' failed: HTTP ${tarResp.status} ${tarResp.statusText}.`,
      );
    }
    const buf = new Uint8Array(await tarResp.arrayBuffer());
    if (buf.byteLength > MAX_TARBALL_SIZE_BYTES) {
      throw new PluginInstallError(
        "PAYLOAD_TOO_LARGE",
        `Tarball for '${source.packageName}' is ${(
          buf.byteLength /
          1024 /
          1024
        ).toFixed(1)}MB, which exceeds the ${(
          MAX_TARBALL_SIZE_BYTES /
          1024 /
          1024
        ).toFixed(0)}MB platform limit.`,
      );
    }

    const bundle = await tryExtractBundle(buf);
    if (bundle) {
      // npm doesn't ship bundle tarballs (those go via GitHub release / direct
      // upload). If we ever encounter one here it means an external author
      // mis-published — reject explicitly rather than silently accept.
      throw new PluginInstallError(
        "BAD_REQUEST",
        `Package '${source.packageName}' from npm contains a bundle manifest. ` +
          `Bundle tarballs must be installed via the GitHub release or tarball-upload sources.`,
      );
    }

    let packageJson;
    try {
      packageJson = await extractPackageJson(buf);
    } catch (error) {
      throw new PluginInstallError(
        "VALIDATION_FAILED",
        `Package '${source.packageName}@${versionLabel}' is not a valid Checkstack plugin: ${extractErrorMessage(error)}`,
      );
    }
    return { tarball: buf, packageJson };
  }

  async installFromArtifact(input: {
    tarball: Uint8Array;
    pluginName: string;
    allowInstallScripts?: boolean;
  }): Promise<InstalledArtifact> {
    return installFromArtifact({ ...input, runtimeDir: this.runtimeDir });
  }
}

function encodeNpmName(name: string): string {
  // npm scoped names use `@scope/name`; the registry expects the slash to
  // remain unencoded but `@` is OK either way.
  return name.startsWith("@") ? name : encodeURIComponent(name);
}
