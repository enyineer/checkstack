import { spawn } from "bun";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import type { PackageSpec } from "@checkstack/script-packages-common";
import type { Resolver, ResolvedPackage } from "./install-service";
import { buildDependencies, buildStorePackageJson } from "./lockfile";
import { renderNpmrc, type NpmrcInput } from "./npmrc";
import { parseBunLock } from "./parse-bun-lock";
import { packDir } from "./cache-archive";
import { findCacheEntry } from "./cache-layout";

/**
 * Concrete central-install {@link Resolver}.
 *
 * In an isolated scratch dir it writes the generated `package.json` +
 * `.npmrc` + a `bunfig.toml` that disables auto-install, runs `bun install`
 * against the (possibly internal) registry into a dedicated cache dir,
 * parses the resulting `bun.lock` for the manifest, then packs each
 * package's Bun cache entry into a content-addressed blob.
 *
 * Runs only on the elected installer. The auth token is written to the
 * scratch `.npmrc` and the whole scratch dir is removed afterwards; the
 * token is never logged.
 */

export interface CentralResolverOptions {
  /** Scratch dir for the resolve (created + removed per resolve). */
  scratchDir: string;
  /** Dedicated Bun cache dir to install into (the publish source). */
  cacheDir: string;
  /** Registry config (token already resolved from the secret store). */
  registry: NpmrcInput;
}

function bunfigDisableAutoInstall(): string {
  // Disable Bun auto-install so a missing package fails fast instead of
  // silently fetching at import time on hosts (matches reconcile behavior).
  return '[install]\nauto = "disable"\n';
}

export function createCentralResolver(
  options: CentralResolverOptions,
): Resolver {
  return {
    async resolve({
      packages,
      ignoreScripts,
    }: {
      packages: PackageSpec[];
      ignoreScripts: boolean;
    }): Promise<ResolvedPackage[]> {
      const { scratchDir, cacheDir, registry } = options;

      // No enabled packages → `bun install` writes no `bun.lock`, so reading
      // it would throw ENOENT and fail the install. Short-circuit to an empty
      // resolved set: an empty manifest yields totalSizeBytes 0 and a
      // deterministic empty-lockfile hash, ending the install in `ready`/0 MB.
      if (Object.keys(buildDependencies(packages)).length === 0) {
        return [];
      }

      await rm(scratchDir, { recursive: true, force: true });
      await mkdir(scratchDir, { recursive: true });
      await mkdir(cacheDir, { recursive: true });

      // From the moment the token-bearing `.npmrc` is written, the scratch
      // dir MUST be removed on every exit path - success OR throw - so the
      // plaintext registry token never lingers on disk (a throw between
      // install and pack would otherwise leak it until the next resolve).
      await writeFile(
        path.join(scratchDir, "package.json"),
        buildStorePackageJson(packages),
      );
      await writeFile(path.join(scratchDir, ".npmrc"), renderNpmrc(registry));
      await writeFile(
        path.join(scratchDir, "bunfig.toml"),
        bunfigDisableAutoInstall(),
      );

      try {
        // Plain `bun install` (no --no-save) so `bun.lock` is written - it's
        // the manifest source. The scratch dir is throwaway, so saving is fine.
        const installArgs = ["install"];
        if (ignoreScripts) installArgs.push("--ignore-scripts");

        const proc = spawn({
          cmd: [process.execPath, ...installArgs],
          cwd: scratchDir,
          env: { ...process.env, BUN_INSTALL_CACHE_DIR: cacheDir },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stderr, exitCode] = await Promise.all([
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        if (exitCode !== 0) {
          // Never include the .npmrc / token; only Bun's own stderr.
          throw new Error(
            `bun install failed (exit ${exitCode}): ${stderr.slice(0, 800)}`,
          );
        }

        const lockText = await Bun.file(
          path.join(scratchDir, "bun.lock"),
        ).text();
        const manifest = parseBunLock(lockText);

        const resolved: ResolvedPackage[] = [];
        for (const entry of manifest) {
          const loc = await findCacheEntry({
            cacheDir,
            name: entry.name,
            version: entry.version,
          });
          if (!loc) {
            throw new Error(
              `Resolved ${entry.name}@${entry.version} but its cache entry was not found; cannot publish blob.`,
            );
          }
          const blob = await packDir(loc);
          resolved.push({ entry, blob });
        }

        return resolved;
      } finally {
        // Best-effort: a cleanup failure must not mask the original outcome.
        await rm(scratchDir, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}
