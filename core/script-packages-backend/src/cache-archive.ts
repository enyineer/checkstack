import { spawn } from "bun";

/**
 * Archive helpers for the content-addressed distribution unit.
 *
 * The distributable blob for each `name@version` is a gzip-compressed tar
 * of that package's Bun cache entry directory. On reconcile a host extracts
 * every needed blob back into its `BUN_INSTALL_CACHE_DIR`, then runs
 * `bun install --offline` which reconstructs `node_modules` with zero
 * network (empirically verified). Bun does the hoisting, so we never have
 * to reconstruct the flat tree ourselves - this keeps the model
 * Bun-version-tolerant while preserving per-package delta sync.
 *
 * We shell to POSIX `tar` (universal on Linux/macOS containers) and use
 * gzip (via tar's `-z`) rather than zstd so there's no external `zstd`
 * binary dependency. The plan named zstd; gzip is the portable substitute.
 */

async function runTar(args: string[], cwd?: string): Promise<Uint8Array> {
  const proc = spawn({
    cmd: ["tar", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).bytes(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`tar failed (exit ${exitCode}): ${stderr.slice(0, 500)}`);
  }
  return stdout;
}

/**
 * Pack a single directory entry (`entryName`) located under `parentDir`
 * into a gzip-compressed tar streamed to stdout. The archive stores the
 * entry by its relative name so it extracts back to the same layout.
 */
export async function packDir({
  parentDir,
  entryName,
}: {
  parentDir: string;
  entryName: string;
}): Promise<Uint8Array> {
  return runTar(["-czf", "-", entryName], parentDir);
}

/** Extract a gzip-compressed tar blob into `targetDir`. */
export async function unpackInto({
  targetDir,
  bytes,
}: {
  targetDir: string;
  bytes: Uint8Array;
}): Promise<void> {
  const proc = spawn({
    cmd: ["tar", "-xzf", "-", "-C", targetDir],
    stdin: bytes,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `tar extract failed (exit ${exitCode}): ${stderr.slice(0, 500)}`,
    );
  }
}
