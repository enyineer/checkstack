import { readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Per-tree "became-non-current-at" sentinel.
 *
 * Tree GC must key its grace window on the moment a tree RETIRED (stopped
 * being `current`), not on the tree dir's mtime. A tree that was `current`
 * for days has an ancient mtime, so keying grace on mtime makes it eligible
 * for deletion the instant it is superseded — while an in-flight run is still
 * pinned to it (the runner snapshots `resolutionRoot` at run start). Keying on
 * retirement time guarantees a tree is only collected once it has been
 * non-current for longer than any run could still be using it.
 *
 * The marker is a tiny file `<treeDir>/.retired-at` holding the epoch-ms
 * timestamp of retirement. It is written at flip time (in
 * {@link import("./atomic-symlink").atomicSymlinkSwap}) for the tree being
 * superseded. Tree GC reads it; a tree with no marker yet is RETAINED (and
 * lazily back-filled — see `tree-gc.ts`) so we never delete on a missing
 * signal.
 */

/** Sentinel file name written into a tree dir when it stops being current. */
export const RETIRED_AT_MARKER = ".retired-at";

/**
 * Record that the tree at `treeDir` became non-current at `at` (epoch ms).
 * Best-effort and idempotent-by-overwrite; never throws (the caller is on a
 * flip hot path where a marker write must not fail the flip).
 */
export async function markTreeRetired({
  treeDir,
  at,
}: {
  treeDir: string;
  at: number;
}): Promise<void> {
  try {
    await writeFile(path.join(treeDir, RETIRED_AT_MARKER), `${at}\n`, "utf8");
  } catch {
    // A failed marker write degrades to the "no marker" path in tree-gc,
    // which RETAINS the tree — safe by construction.
  }
}

/**
 * Read the retirement timestamp (epoch ms) for the tree at `treeDir`, or
 * `undefined` when no marker exists (or it is unreadable / malformed).
 */
export async function readTreeRetiredAt({
  treeDir,
}: {
  treeDir: string;
}): Promise<number | undefined> {
  let raw: string;
  try {
    raw = await readFile(path.join(treeDir, RETIRED_AT_MARKER), "utf8");
  } catch {
    return undefined;
  }
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * True when `treeDir` already carries a retirement marker. Used by tree-GC to
 * decide whether to back-fill one for a tree that is non-current but has no
 * marker yet (e.g. a tree superseded before this scheme existed).
 */
export async function hasRetirementMarker({
  treeDir,
}: {
  treeDir: string;
}): Promise<boolean> {
  try {
    await stat(path.join(treeDir, RETIRED_AT_MARKER));
    return true;
  } catch {
    return false;
  }
}
