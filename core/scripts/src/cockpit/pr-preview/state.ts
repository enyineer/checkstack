import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Persisted state for the PR-preview instance, stored under the gitignored
 * `.dev/` directory. Lets a re-run report the previous snapshot and merged PRs.
 */
export const previewStateSchema = z.object({
  /** ISO timestamp of when the current db snapshot was taken. */
  snapshotAt: z.string().optional(),
  /** PR numbers merged into the current preview worktree. */
  mergedPrs: z.array(z.number().int()).optional(),
  /** Absolute path of the merged worktree. */
  worktreePath: z.string().optional(),
});
export type PreviewState = z.infer<typeof previewStateSchema>;

const EMPTY: PreviewState = {};

/** Path to the state file for a given repo root. */
export function stateFilePath(repoRoot: string): string {
  return path.join(repoRoot, ".dev", "pr-preview", "state.json");
}

/** Parse raw JSON into state, falling back to empty on any malformed input. */
export function parsePreviewState(raw: string): PreviewState {
  try {
    const result = previewStateSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** Read persisted state, or empty state when none exists / is unreadable. */
export function readPreviewState({ repoRoot }: { repoRoot: string }): PreviewState {
  const file = stateFilePath(repoRoot);
  if (!fs.existsSync(file)) return EMPTY;
  return parsePreviewState(fs.readFileSync(file, "utf8"));
}

/** Persist state, creating the `.dev/pr-preview/` directory if needed. */
export function writePreviewState({
  repoRoot,
  state,
}: {
  repoRoot: string;
  state: PreviewState;
}): void {
  const file = stateFilePath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
