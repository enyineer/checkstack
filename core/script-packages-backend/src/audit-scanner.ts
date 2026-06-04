import { spawn } from "bun";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import type {
  AuditAdvisory,
  PackageSpec,
} from "@checkstack/script-packages-common";
import { buildDependencies, buildStorePackageJson } from "./lockfile";
import { renderNpmrc, type NpmrcInput } from "./npmrc";
import { parseBunAudit } from "./audit-parse";

/**
 * Minimal subset of Bun's `spawn` the scanner relies on. Injectable so tests
 * can assert on the spawn options (e.g. `BUN_INSTALL_CACHE_DIR`) without
 * launching a real process.
 */
export interface SpawnHandle {
  // The scanner always spawns with `stdout`/`stderr: "pipe"`, so both are
  // readable streams (never fds).
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
}
export interface SpawnOptions {
  cmd: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  stdout: "pipe";
  stderr: "pipe";
}
export type SpawnFn = (options: SpawnOptions) => SpawnHandle;

/**
 * Runs `bun audit --json` against the resolved script-packages tree, reusing
 * the EXACT scratch / `.npmrc` / registry-config setup the installer's
 * {@link createCentralResolver} uses (same `package.json`, same token-bearing
 * `.npmrc`, same throwaway-scratch cleanup) so audit and install never drift
 * on registry/auth config. The audit reports purely from the lockfile against
 * the advisory DB - no install scripts run.
 *
 * The token-bearing scratch dir is removed on EVERY exit path (success OR
 * throw) so the plaintext registry token never lingers on disk.
 */

export interface AuditScannerOptions {
  /** Scratch dir for the audit (created + removed per scan). */
  scratchDir: string;
  /**
   * Dedicated Bun cache dir to install into - MUST be the same
   * `BUN_INSTALL_CACHE_DIR` the installer's resolver uses (`paths.cache`), so
   * the audit reuses already-fetched packages instead of re-downloading into
   * Bun's default global cache and drifting from the install path.
   */
  cacheDir: string;
  /** Registry config (token already resolved from the secret store). */
  registry: NpmrcInput;
  /** Injectable spawn (defaults to Bun's `spawn`); for tests. */
  spawnFn?: SpawnFn;
}

export interface AuditScanResult {
  advisories: AuditAdvisory[];
}

function bunfigDisableAutoInstall(): string {
  return '[install]\nauto = "disable"\n';
}

export interface AuditScanner {
  scan(input: {
    packages: PackageSpec[];
    ignoreScripts: boolean;
  }): Promise<AuditScanResult>;
}

export function createAuditScanner(options: AuditScannerOptions): AuditScanner {
  return {
    async scan({ packages, ignoreScripts }) {
      const { scratchDir, cacheDir, registry } = options;
      const spawnFn: SpawnFn = options.spawnFn ?? ((o) => spawn(o));

      // No enabled packages → nothing to audit.
      if (Object.keys(buildDependencies(packages)).length === 0) {
        return { advisories: [] };
      }

      await rm(scratchDir, { recursive: true, force: true });
      await mkdir(scratchDir, { recursive: true });
      await mkdir(cacheDir, { recursive: true });

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
        // Install (writes bun.lock from the fully-pinned set) so audit has a
        // lockfile to report against. `--ignore-scripts` keeps the
        // supply-chain guardrail: audit reads the lockfile + advisory DB, it
        // does not execute package code.
        const installArgs = ["install"];
        if (ignoreScripts) installArgs.push("--ignore-scripts");
        const install = spawnFn({
          cmd: [process.execPath, ...installArgs],
          cwd: scratchDir,
          env: { ...process.env, BUN_INSTALL_CACHE_DIR: cacheDir },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [installStderr, installExit] = await Promise.all([
          new Response(install.stderr).text(),
          install.exited,
        ]);
        if (installExit !== 0) {
          throw new Error(
            `bun install (for audit) failed (exit ${installExit}): ${installStderr.slice(0, 800)}`,
          );
        }

        // `bun audit --json` exit code is unreliable (non-zero even on a
        // clean tree in some Bun versions), so we IGNORE it and parse stdout.
        const audit = spawnFn({
          cmd: [process.execPath, "audit", "--json"],
          cwd: scratchDir,
          env: { ...process.env, BUN_INSTALL_CACHE_DIR: cacheDir },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr] = await Promise.all([
          new Response(audit.stdout).text(),
          new Response(audit.stderr).text(),
          audit.exited,
        ]);

        try {
          return parseBunAudit(stdout);
        } catch (parseError) {
          // Surface Bun's own stderr (never the .npmrc / token) to aid
          // diagnosis when the output wasn't parseable JSON.
          throw new Error(
            `Could not parse bun audit output: ${(parseError as Error).message}${
              stderr ? ` (stderr: ${stderr.slice(0, 400)})` : ""
            }`,
          );
        }
      } finally {
        await rm(scratchDir, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}
