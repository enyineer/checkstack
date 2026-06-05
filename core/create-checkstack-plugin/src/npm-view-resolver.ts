import { spawn } from "node:child_process";
import type { VersionResolver } from "@checkstack/scripts/scaffold";

/**
 * npm-view-backed {@link VersionResolver} for the standalone scaffolder.
 *
 * The scaffolding engine (in `@checkstack/scripts`) rewrites every
 * `workspace:*` range in the rendered trio to a concrete version via an
 * injected resolver. This is the production resolver: it queries the
 * registry's `latest` dist-tag (or a `--version-tag`) per dependency via
 * `npm view <pkg>@<tag> version` and pins a caret range (`^<version>`).
 *
 * Key behaviours:
 *   - `@checkstack/*` versions are 0.x and NOT lockstepped, so each dep is
 *     resolved independently (one `npm view` per package), with a single
 *     in-process cache so repeated lookups hit the registry once.
 *   - The three local trio siblings (`widget-common`, `widget-backend`,
 *     `widget-frontend`) are NOT published; they install from the local
 *     Bun workspace, so the resolver returns their `workspace:*` range
 *     unchanged (and `plugin-pack --bundle` rewrites them at pack time).
 *   - A registry miss returns `undefined` so the engine can aggregate and
 *     fail loud with the full list of unresolved deps. A subprocess error
 *     (registry unreachable) propagates as a thrown error.
 */

/** Result of querying the registry for one package's version. */
export interface NpmViewResult {
  /** The concrete version, or `undefined` if the package was not found. */
  version: string | undefined;
}

/** Injectable subprocess seam: runs `npm view` for one package. */
export type NpmViewRunner = (args: {
  packageName: string;
  registry?: string;
  versionTag: string;
}) => Promise<NpmViewResult>;

/**
 * Build the `npm view` argument vector for one package. Pure, so the exact
 * registry/tag threading is unit-testable without spawning a process.
 */
export function buildNpmViewArgs({
  packageName,
  versionTag = "latest",
  registry,
}: {
  packageName: string;
  versionTag?: string;
  registry?: string;
}): string[] {
  const args = ["view", `${packageName}@${versionTag}`, "version"];
  if (registry) args.push("--registry", registry);
  return args;
}

/**
 * Default {@link NpmViewRunner}: spawns `npm view`, captures stdout, and
 * parses the printed version. A non-zero exit (other than "package not
 * found") rejects so the caller surfaces a clear network error.
 */
export const spawnNpmViewRunner: NpmViewRunner = ({
  packageName,
  registry,
  versionTag,
}) => {
  const args = buildNpmViewArgs({ packageName, versionTag, registry });
  return new Promise<NpmViewResult>((resolve, reject) => {
    const child = spawn("npm", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const version = stdout.trim().replaceAll(/['"]/g, "") || undefined;
      if (code === 0) {
        resolve({ version });
        return;
      }
      // `npm view` exits non-zero when the package is absent (E404). Treat
      // that as "unresolved" (undefined) so the engine aggregates; any other
      // failure (network, auth) is a hard error.
      if (/E404|404 Not Found|is not in this registry/i.test(stderr)) {
        resolve({ version: undefined });
        return;
      }
      reject(
        new Error(
          `npm view ${packageName} exited with status ${code}: ${stderr.trim()}`,
        ),
      );
    });
  });
};

/**
 * Create the npm-view-backed resolver.
 *
 * @param runNpmView injectable subprocess seam (defaults to a real
 *   `npm view` spawn). Tests pass a fake.
 * @param registry optional registry URL to thread into `npm view`.
 * @param versionTag dist-tag to resolve (default `latest`).
 * @param localSiblings the generated trio package names, left as
 *   `workspace:*` because they resolve from the local workspace.
 */
export function createNpmViewResolver({
  runNpmView = spawnNpmViewRunner,
  registry,
  versionTag = "latest",
  localSiblings = new Set<string>(),
}: {
  runNpmView?: NpmViewRunner;
  registry?: string;
  versionTag?: string;
  localSiblings?: Set<string>;
} = {}): VersionResolver {
  const cache = new Map<string, Promise<string | undefined>>();

  return ({ packageName, workspaceRange }) => {
    // Local trio siblings are not published: keep the workspace range so
    // `bun install` resolves them from the local workspace.
    if (localSiblings.has(packageName)) {
      return Promise.resolve(workspaceRange);
    }

    const cached = cache.get(packageName);
    if (cached) return cached;

    const resolution = runNpmView({ packageName, registry, versionTag }).then(
      ({ version }) => (version ? `^${version}` : undefined),
    );
    cache.set(packageName, resolution);
    return resolution;
  };
}
