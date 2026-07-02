import path from "node:path";

/** Root of the PR-preview scratch area (gitignored `.dev/`). */
export function previewRoot(repoRoot: string): string {
  return path.join(repoRoot, ".dev", "pr-preview");
}

/** The merged worktree path used by the preview instance. */
export function worktreePath(repoRoot: string): string {
  return path.join(previewRoot(repoRoot), "worktree");
}

/**
 * Isolated `CHECKSTACK_DATA_DIR` for the preview instance's script-package store.
 * Kept OUTSIDE the worktree (under `.dev/`) so it survives worktree recreation
 * and is seeded from the dev instance's `.data`, so the preview reuses the
 * already-built package trees instead of a cold `bun install --offline`.
 */
export function previewDataDir(repoRoot: string): string {
  return path.join(previewRoot(repoRoot), "data");
}
