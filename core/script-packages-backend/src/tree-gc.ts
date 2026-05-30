import { readdir, stat, rm } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_TREE_GC_GRACE_MS } from "@checkstack/script-packages-common";
import { extractErrorMessage } from "@checkstack/common";
import { storePaths } from "./data-dir";
import { readCurrentTarget } from "./atomic-symlink";

/**
 * Host-local tree garbage collection: prune materialized
 * `trees/<lockfileHash>/` dirs whose hash is NOT the one `current` points at,
 * after a grace period. Applies identically to core pods and satellites (the
 * materialize/flip code is shared, so this sweep is too).
 *
 * ## Why the conservative grace window (active-run safety)
 *
 * The runner pins in-flight runs to the tree they STARTED on by snapshotting
 * `resolutionRoot` (which dereferences `<store>/current` at run start). After
 * an atomic flip, a live run keeps resolving against the old tree's
 * `node_modules`; deleting that tree mid-run would break the run.
 *
 * There is no robust cross-process refcount available here: runs execute in
 * throwaway Bun subprocesses under `.runs/<uuid>/` whose `resolutionRoot`
 * points at `current` (a symlink), not at a specific tree, and a crashed
 * run leaves no reliable "release" signal. A naive refcount would leak on
 * crash and could under-count, risking deletion of a live tree. So we take
 * the **robust** option: a grace window keyed on the tree dir's mtime that is
 * chosen to comfortably exceed the longest possible script-run timeout. A
 * tree only becomes eligible once it has been non-current for longer than any
 * run could still be using it. When in doubt, we retain.
 *
 * `current`'s target is NEVER a candidate, regardless of age.
 */

export interface TreeGcResult {
  /** Tree hashes deleted this pass. */
  deleted: string[];
  /** Non-current tree hashes kept because still within the grace window. */
  keptWithinGrace: string[];
  /** The hash `current` points at (never a candidate), if any. */
  currentHash?: string;
}

/**
 * Sweep the `trees/` dir of one host store, deleting non-current trees older
 * than the grace window. Idempotent and crash-safe (a partially-deleted tree
 * is simply re-swept next pass).
 *
 * @param storeRoot the package-store root (`<dataDir>/script-packages`).
 * @param graceMs grace window in ms (default 1h, > the max run timeout).
 * @param now injectable clock for deterministic tests.
 */
export async function sweepTreeGc({
  storeRoot,
  graceMs = DEFAULT_TREE_GC_GRACE_MS,
  now = Date.now(),
  logger,
}: {
  storeRoot: string;
  graceMs?: number;
  now?: number;
  logger?: { debug(msg: string): void; error(msg: string): void };
}): Promise<TreeGcResult> {
  const paths = storePaths(storeRoot);

  // The hash `current` points at (basename of `trees/<hash>`). NEVER deleted.
  const currentTarget = await readCurrentTarget(paths.current);
  const currentHash = currentTarget
    ? path.basename(currentTarget)
    : undefined;

  let entries: string[];
  try {
    entries = await readdir(paths.trees);
  } catch {
    // No trees dir yet → nothing to GC.
    return { deleted: [], keptWithinGrace: [], currentHash };
  }

  const deleted: string[] = [];
  const keptWithinGrace: string[] = [];

  for (const hash of entries) {
    if (hash === currentHash) continue; // never delete the live tree

    const treeDir = path.join(paths.trees, hash);
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(treeDir);
    } catch {
      continue; // vanished between readdir and stat; nothing to do
    }
    if (!info.isDirectory()) continue;

    // Grace keyed on mtime: the dir's mtime is bumped on materialize, so a
    // tree that has been non-current for longer than the grace window has
    // had no fresh runs pinned to it for at least that long.
    const ageMs = now - info.mtimeMs;
    if (ageMs < graceMs) {
      keptWithinGrace.push(hash);
      logger?.debug(
        `Tree GC: keeping non-current tree ${hash} (age ${Math.round(
          ageMs / 1000,
        )}s < grace ${Math.round(graceMs / 1000)}s; a run may still be pinned).`,
      );
      continue;
    }

    try {
      await rm(treeDir, { recursive: true, force: true });
      deleted.push(hash);
      logger?.debug(`Tree GC: deleted non-current tree ${hash}.`);
    } catch (error) {
      logger?.error(
        `Tree GC: failed to delete tree ${hash}: ${extractErrorMessage(
          error,
        )}. Retaining for the next pass.`,
      );
    }
  }

  logger?.debug(
    `Tree GC complete: current=${currentHash ?? "(none)"}, ${deleted.length} deleted, ${keptWithinGrace.length} kept within grace.`,
  );

  return { deleted, keptWithinGrace, currentHash };
}
