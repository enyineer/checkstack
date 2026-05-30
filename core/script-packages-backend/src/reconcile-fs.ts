import { spawn } from "bun";
import { mkdir, writeFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { ManifestEntry } from "@checkstack/script-packages-common";
import type { ReconcileDeps } from "./reconciler";
import { unpackInto } from "./cache-archive";
import { atomicSymlinkSwap, readCurrentTarget } from "./atomic-symlink";
import { storePaths } from "./data-dir";

/**
 * Concrete filesystem/Bun adapter for the host {@link ReconcileDeps}.
 *
 * Layout under the store root:
 *   - `cache/`                 Bun cache (blobs extracted here)
 *   - `cache/.cs-integrity/`   marker files (hex integrity) tracking which
 *                              blobs are seeded - the cache dir names are
 *                              `name@version@@@n`, not integrities, so we
 *                              track presence out-of-band for delta diffing
 *   - `trees/<lockfileHash>/`  a materialized install (package.json + the
 *                              `bun install --offline` node_modules)
 *   - `current -> trees/<hash>`atomically-flipped symlink the runner's
 *                              `resolutionRoot` points at
 *
 * Materialize seeds nothing itself - the reconciler has already extracted
 * the needed blobs into `cache/`. It writes a package.json whose deps are
 * the manifest's top-level set, runs `bun install --offline` (zero network,
 * reconstructs node_modules from the warm cache), then atomically flips
 * `current`.
 */

const INTEGRITY_MARKER_DIR = ".cs-integrity";

function integrityMarkerName(integrity: string): string {
  return Buffer.from(integrity, "utf8").toString("hex");
}

function bunfigDisableAutoInstall(): string {
  return '[install]\nauto = "disable"\n';
}

export function createReconcileFsDeps(input: {
  storeRoot: string;
  /** Fetch a blob (shared store on core; HTTP on satellite). */
  fetchBlob: (input: { integrity: string }) => Promise<Uint8Array>;
  logger?: { debug(msg: string): void; error(msg: string): void };
}): ReconcileDeps {
  const paths = storePaths(input.storeRoot);
  const markerDir = path.join(paths.cache, INTEGRITY_MARKER_DIR);

  return {
    logger: input.logger,

    async localCacheIntegrities() {
      try {
        const hexes = await readdir(markerDir);
        return hexes.map((hex) =>
          Buffer.from(hex, "hex").toString("utf8"),
        );
      } catch {
        return [];
      }
    },

    fetchBlob: input.fetchBlob,

    async seedBlob({ entry, bytes }) {
      await mkdir(paths.cache, { recursive: true });
      await unpackInto({ targetDir: paths.cache, bytes });
      await mkdir(markerDir, { recursive: true });
      await writeFile(
        path.join(markerDir, integrityMarkerName(entry.integrity)),
        entry.integrity,
      );
    },

    async currentLockfileHash() {
      const target = await readCurrentTarget(paths.current);
      if (!target) return;
      // target is `trees/<hash>`; the hash is the basename.
      return path.basename(target);
    },

    async materializeAndFlip({ lockfileHash, manifest }) {
      const treeDir = path.join(paths.trees, lockfileHash);
      // If the tree already exists with a node_modules, just (re)flip.
      const alreadyBuilt = await dirExists(path.join(treeDir, "node_modules"));
      if (!alreadyBuilt) {
        await mkdir(treeDir, { recursive: true });
        await writeFile(
          path.join(treeDir, "package.json"),
          renderManifestPackageJson(manifest),
        );
        await writeFile(
          path.join(treeDir, "bunfig.toml"),
          bunfigDisableAutoInstall(),
        );
        const proc = spawn({
          cmd: [
            process.execPath,
            "install",
            "--offline",
            "--no-save",
            "--ignore-scripts",
          ],
          cwd: treeDir,
          env: { ...process.env, BUN_INSTALL_CACHE_DIR: paths.cache },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stderr, exitCode] = await Promise.all([
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        if (exitCode !== 0) {
          throw new Error(
            `bun install --offline failed for ${lockfileHash} (exit ${exitCode}): ${stderr.slice(0, 800)}`,
          );
        }
      }
      await atomicSymlinkSwap({
        linkPath: paths.current,
        target: path.join("trees", lockfileHash),
      });
    },
  };
}

/**
 * Build the package.json for a materialized tree. Pins every manifest
 * package by exact version so `bun install --offline` resolves the same
 * tree the installer produced (transitive deps are already in the cache).
 */
function renderManifestPackageJson(manifest: ManifestEntry[]): string {
  const dependencies: Record<string, string> = {};
  for (const entry of manifest) {
    dependencies[entry.name] = entry.version;
  }
  return (
    JSON.stringify(
      {
        name: "checkstack-script-packages-tree",
        private: true,
        dependencies: Object.fromEntries(
          Object.entries(dependencies).toSorted(([a], [b]) =>
            a.localeCompare(b),
          ),
        ),
      },
      null,
      2,
    ) + "\n"
  );
}

async function dirExists(dir: string): Promise<boolean> {
  try {
    const info = await stat(dir);
    return info.isDirectory();
  } catch {
    return false;
  }
}
