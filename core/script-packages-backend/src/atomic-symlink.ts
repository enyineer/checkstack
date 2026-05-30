import { symlink, rename, rm, readlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Atomically point `linkPath` at `target`.
 *
 * Creates a uniquely-named temp symlink in the same directory, then
 * `rename()`s it over `linkPath` - `rename` is atomic on POSIX, so a
 * concurrent reader sees either the old target or the new one, never a
 * half-written link. New runs follow the new symlink; in-flight runs keep
 * resolving against the dir they started on (the old tree is untouched).
 */
export async function atomicSymlinkSwap({
  linkPath,
  target,
}: {
  linkPath: string;
  target: string;
}): Promise<void> {
  const dir = path.dirname(linkPath);
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
