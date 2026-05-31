import { symlink, rename, rm, readlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { markTreeRetired } from "./tree-retirement";

/**
 * Atomically point `linkPath` at `target`.
 *
 * Creates a uniquely-named temp symlink in the same directory, then
 * `rename()`s it over `linkPath` - `rename` is atomic on POSIX, so a
 * concurrent reader sees either the old target or the new one, never a
 * half-written link. New runs follow the new symlink; in-flight runs keep
 * resolving against the dir they started on (the old tree is untouched).
 *
 * Records the **retirement time** of the tree being superseded: right at the
 * flip we stamp a `.retired-at` marker into the OLD target's dir (when it
 * differs from the new target). Tree GC keys its grace window on that
 * timestamp rather than the tree dir's mtime, so a long-current tree (ancient
 * mtime) is NOT instantly eligible for deletion the moment it is superseded -
 * which would otherwise yank the rug from under an in-flight run still pinned
 * to it. See {@link import("./tree-retirement")}.
 */
export async function atomicSymlinkSwap({
  linkPath,
  target,
  now = Date.now(),
}: {
  linkPath: string;
  target: string;
  /** Injectable clock for the retirement timestamp (deterministic tests). */
  now?: number;
}): Promise<void> {
  const dir = path.dirname(linkPath);

  // Stamp the tree that is about to stop being current with its retirement
  // time, BEFORE the flip. Resolved relative to the link's dir (targets are
  // stored relative, e.g. `trees/<hash>`). Best-effort: a read/write failure
  // degrades to the "no marker" path in tree-GC, which RETAINS the tree.
  const oldTarget = await readCurrentTarget(linkPath);
  if (oldTarget && oldTarget !== target) {
    const oldTreeDir = path.isAbsolute(oldTarget)
      ? oldTarget
      : path.join(dir, oldTarget);
    await markTreeRetired({ treeDir: oldTreeDir, at: now });
  }

  const tmpLink = path.join(dir, `.current-${randomUUID()}`);
  await symlink(target, tmpLink);
  try {
    await rename(tmpLink, linkPath);
  } catch (error) {
    await rm(tmpLink, { force: true }).catch(() => {});
    throw error;
  }
}

/** Resolve the current symlink target, or undefined if it doesn't exist. */
export async function readCurrentTarget(
  linkPath: string,
): Promise<string | undefined> {
  try {
    return await readlink(linkPath);
  } catch {
    return;
  }
}
