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
 * Reject any archive entry that is NOT a plain file or directory.
 *
 * Path-only validation ({@link unsafeArchivePath}) is blind to LINK TARGETS:
 * a symlink with a harmless NAME (e.g. `evil`, no `..`/abs) but an escaping
 * TARGET (`-> /etc`, `-> ../../..`) passes the name check, then a later
 * regular-file entry can be written THROUGH the link and escape `targetDir`.
 * Reconstructed Bun-cache trees are plain files + dirs, so we reject every
 * symlink/hardlink/device/fifo entry outright (defence in depth, independent
 * of any tar extraction flag).
 *
 * `line` is one row of `tar -tzvf` verbose output; its first character is the
 * POSIX type flag (`-` file, `d` dir, `l` symlink, `h` hardlink, etc.) on
 * both GNU and BSD/libarchive tar. Returns the offending reason, or
 * `undefined` for a safe (file/dir) entry or a blank line.
 */
function unsafeArchiveEntryType(line: string): string | undefined {
  const trimmed = line.trimEnd();
  if (trimmed.trim() === "") return undefined; // trailing blank line
  const typeFlag = trimmed[0];
  if (typeFlag === "-" || typeFlag === "d") return undefined; // file or dir
  if (typeFlag === "l" || typeFlag === "h") {
    return `link entry (type "${typeFlag}") in "${trimmed}"`;
  }
  // Anything else (block/char device "b"/"c", fifo "p", socket "s", …) is
  // never part of a package cache tree → reject.
  return `non-regular entry (type "${typeFlag}") in "${trimmed}"`;
}

/**
 * Extract a gzip-compressed tar blob into `targetDir`.
 *
 * Hardened against zip-slip on two axes, both checked BEFORE any bytes are
 * written (a violation aborts the whole extract, materializing nothing):
 *
 *   1. Entry PATHS must be relative and free of `..` components — a
 *      traversing / absolute name would write outside `targetDir`.
 *   2. Entry TYPES must be plain file or directory — a symlink/hardlink with
 *      a harmless name but an escaping target would let a later file write
 *      THROUGH it and escape `targetDir`. Reconstructed Bun-cache trees never
 *      contain links, so any link/device/fifo entry is rejected.
 *
 * We validate explicitly (rather than relying on a tar flag) so the behaviour
 * is identical across GNU and BSD/libarchive tar. The verbose listing
 * (`-tzvf`) carries both the type flag (column 0) and the path, so a single
 * listing pass covers both checks.
 */
export async function unpackInto({
  targetDir,
  bytes,
}: {
  targetDir: string;
  bytes: Uint8Array;
}): Promise<void> {
  // 1. List entries (verbose: type flag + path) and validate BEFORE extract.
  //    `-tzvf` rows look like `lrwxr-xr-x 0 user grp 0 <date> name -> target`;
  //    the path/name portion is what `-tzf` would print, so we run the plain
  //    listing for the path check and the verbose listing for the type check.
  const [pathListing, typeListing] = await Promise.all([
    runTarCapture(["-tzf", "-"], bytes),
    runTarCapture(["-tzvf", "-"], bytes),
  ]);
  for (const line of pathListing.split("\n")) {
    const reason = unsafeArchivePath(line);
    if (reason) {
      throw new Error(`refusing to extract unsafe archive entry: ${reason}`);
    }
  }
  for (const line of typeListing.split("\n")) {
    const reason = unsafeArchiveEntryType(line);
    if (reason) {
      throw new Error(`refusing to extract unsafe archive entry: ${reason}`);
    }
  }

  // 2. Extract. `--no-same-owner` avoids surprising ownership; paths + types
  // are already proven relative + confined + link-free above.
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
