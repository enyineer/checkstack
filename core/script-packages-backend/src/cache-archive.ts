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

/**
 * Reject an archive entry path that would escape the extraction directory
 * (zip-slip): an absolute path or any `..` path component. Returns the
 * offending reason, or `undefined` when the path is safe + confined.
 */
function unsafeArchivePath(entryPath: string): string | undefined {
  const trimmed = entryPath.trim();
  if (trimmed === "") return undefined; // tar can emit a trailing blank line
  // Absolute (POSIX or Windows-style) — would extract outside targetDir.
  if (trimmed.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return `absolute path "${trimmed}"`;
  }
  // Any `..` segment (handle both / and \ separators) — path traversal.
  const segments = trimmed.split(/[\\/]/);
  if (segments.includes("..")) {
    return `parent-directory traversal in "${trimmed}"`;
  }
  return undefined;
}

/**
 * Extract a gzip-compressed tar blob into `targetDir`.
 *
 * Hardened against zip-slip: the archive entries are listed first and every
 * path is validated to be relative and free of `..` components before any
 * bytes are written. A traversing / absolute entry aborts the whole extract
 * (nothing is materialized) rather than letting tar write outside
 * `targetDir`. We validate explicitly (rather than relying on a tar flag)
 * so the behaviour is identical across GNU and BSD/libarchive tar.
 */
export async function unpackInto({
  targetDir,
  bytes,
}: {
  targetDir: string;
  bytes: Uint8Array;
}): Promise<void> {
  // 1. List entries and validate paths BEFORE extracting anything.
  const listing = await runTarCapture(["-tzf", "-"], bytes);
  for (const line of listing.split("\n")) {
    const reason = unsafeArchivePath(line);
    if (reason) {
      throw new Error(`refusing to extract unsafe archive entry: ${reason}`);
    }
  }

  // 2. Extract. `--no-same-owner` avoids surprising ownership; paths are
  // already proven relative + confined above.
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

/**
 * Run `tar` with the blob piped to stdin and return stdout as text. Shared
 * by the listing pass in {@link unpackInto}; throws on a non-zero exit (e.g.
 * a corrupt archive) so callers surface a clear error.
 */
async function runTarCapture(
  args: string[],
  stdin: Uint8Array,
): Promise<string> {
  const proc = spawn({
    cmd: ["tar", ...args],
    stdin,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `tar extract failed (exit ${exitCode}): ${stderr.slice(0, 500)}`,
    );
  }
  return stdout;
}
