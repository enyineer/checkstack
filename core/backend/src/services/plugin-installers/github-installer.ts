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

interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GithubRelease {
  tag_name: string;
  assets: GithubReleaseAsset[];
}

/**
 * Install a plugin from a GitHub release.
 *
 * Convention (enforced by the `@checkstack/scripts plugin-pack` CLI):
 *   - The release for tag `vX.Y.Z` includes exactly one `.tgz` asset.
 *   - For multi-package plugins (`checkstack.bundle` set on the primary),
 *     that asset is a `--bundle`-mode outer tarball with `bundle.json`.
 *
 * Building never happens at install time — the CLI runs at release time.
 */
export class GithubPluginInstaller implements PluginInstaller {
  constructor(private readonly runtimeDir: string) {}

  async fetchTarball(source: PluginSource): Promise<FetchedTarball> {
    if (source.type !== "github") {
      throw new Error(
        `GithubPluginInstaller cannot handle source type '${source.type}'`,
      );
    }

    // Determine API base. Defaults to public github.com; for GitHub
    // Enterprise the source carries an explicit `apiBaseUrl` like
    // `https://github.example.com/api/v3`. We strip a trailing slash so
    // either form (`/api/v3` or `/api/v3/`) is accepted.
    const apiBase = (
      source.apiBaseUrl ?? "https://api.github.com"
    ).replace(/\/$/, "");
    const releaseUrl = `${apiBase}/repos/${source.owner}/${source.repo}/releases/tags/${source.tag}`;
    rootLogger.info(`📦 Resolving GitHub release: ${releaseUrl}`);

    // Token resolution: configurable env var name (defaults to
    // `GITHUB_TOKEN`). Different deployments may need to talk to several
    // GitHub instances (public + enterprise), so we let the source
    // declare which env var holds the right PAT.
    const tokenEnvVar = source.tokenEnvVar ?? "GITHUB_TOKEN";
    const token = process.env[tokenEnvVar];

    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const repoLabel = `${source.owner}/${source.repo}@${source.tag}`;

    let meta: Response;
    try {
      meta = await fetch(releaseUrl, { headers });
    } catch (error) {
      throw new PluginInstallError(
        "BAD_GATEWAY",
        `Could not reach GitHub at ${apiBase}: ${extractErrorMessage(error)}`,
      );
    }
    if (!meta.ok) {
      if (meta.status === 404) {
        throw new PluginInstallError(
          "NOT_FOUND",
          `GitHub release '${repoLabel}' not found. Verify the owner, repo, and tag, ` +
            `and (for private repos) that the platform's PAT in '${tokenEnvVar}' has access.`,
        );
      }
      if (meta.status === 401) {
        throw new PluginInstallError(
          "UNAUTHORIZED",
          token
            ? `GitHub rejected the token in '${tokenEnvVar}' (HTTP 401). The token may be expired.`
            : `GitHub release '${repoLabel}' requires authentication. Set a PAT in '${tokenEnvVar}'.`,
        );
      }
      if (meta.status === 403) {
        throw new PluginInstallError(
          "FORBIDDEN",
          `GitHub returned 403 for '${repoLabel}'. Either rate-limited or the token in '${tokenEnvVar}' lacks access.`,
        );
      }
      throw new PluginInstallError(
        "BAD_GATEWAY",
        `GitHub release lookup returned HTTP ${meta.status} for ${repoLabel}.`,
      );
    }
    const release = (await meta.json()) as GithubRelease;

    const tgzAssets = release.assets.filter((a) => a.name.endsWith(".tgz"));
    let asset: GithubReleaseAsset | undefined;
    if (source.assetName) {
      asset = release.assets.find((a) => a.name === source.assetName);
      if (!asset) {
        throw new PluginInstallError(
          "NOT_FOUND",
          `Release '${repoLabel}' has no asset named '${source.assetName}'. ` +
            `Available .tgz assets: ${
              tgzAssets.map((a) => a.name).join(", ") || "(none)"
            }.`,
        );
      }
    } else if (tgzAssets.length === 1) {
      asset = tgzAssets[0];
    } else if (tgzAssets.length === 0) {
      throw new PluginInstallError(
        "NOT_FOUND",
        `Release '${repoLabel}' has no .tgz asset. ` +
          `Run 'bunx @checkstack/scripts plugin-pack' in the plugin repo and attach the produced tarball to the release.`,
      );
    } else {
      throw new PluginInstallError(
        "BAD_REQUEST",
        `Release '${repoLabel}' has ${tgzAssets.length} .tgz assets (${tgzAssets
          .map((a) => a.name)
          .join(", ")}) — set 'assetName' on the source to disambiguate.`,
      );
    }

    if (asset.size > MAX_TARBALL_SIZE_BYTES) {
      throw new PluginInstallError(
        "PAYLOAD_TOO_LARGE",
        `Release asset '${asset.name}' is ${(asset.size / 1024 / 1024).toFixed(
          1,
        )}MB, which exceeds the ${(MAX_TARBALL_SIZE_BYTES / 1024 / 1024).toFixed(
          0,
        )}MB platform limit.`,
      );
    }

    rootLogger.info(`📦 Downloading: ${asset.browser_download_url}`);
    let tarResp: Response;
    try {
      tarResp = await fetch(asset.browser_download_url, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
    } catch (error) {
      throw new PluginInstallError(
        "BAD_GATEWAY",
        `Could not download release asset '${asset.name}': ${extractErrorMessage(error)}`,
      );
    }
    if (!tarResp.ok) {
      throw new PluginInstallError(
        "BAD_GATEWAY",
        `Failed to download release asset '${asset.name}': HTTP ${tarResp.status} ${tarResp.statusText}.`,
      );
    }
    const buf = new Uint8Array(await tarResp.arrayBuffer());

    const bundle = await tryExtractBundle(buf);
    if (bundle) {
      const primary = bundle.siblings.find(
        (s) => s.packageJson.name === bundle.manifest.primary,
      );
      if (!primary) {
        throw new PluginInstallError(
          "VALIDATION_FAILED",
          `Bundle manifest in '${asset.name}' names primary '${bundle.manifest.primary}' but no matching sibling tarball was found.`,
        );
      }
      // Persist/install the primary's INNER package tarball (a plain
      // `package/package.json` tarball), not the outer bundle archive `buf`;
      // the bundle is exposed via `bundle` for sibling resolution only.
      return { tarball: primary.tarball, packageJson: primary.packageJson, bundle };
    }

    let packageJson;
    try {
      packageJson = await extractPackageJson(buf);
    } catch (error) {
      throw new PluginInstallError(
        "VALIDATION_FAILED",
        `Release asset '${asset.name}' is not a valid Checkstack plugin tarball: ${extractErrorMessage(error)}`,
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
