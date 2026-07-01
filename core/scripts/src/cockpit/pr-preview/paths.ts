import path from "node:path";

/** Root of the PR-preview scratch area (gitignored `.dev/`). */
export function previewRoot(repoRoot: string): string {
  return path.join(repoRoot, ".dev", "pr-preview");
}

/** The merged worktree path used by the preview instance. */
export function worktreePath(repoRoot: string): string {
  return path.join(previewRoot(repoRoot), "worktree");
}
