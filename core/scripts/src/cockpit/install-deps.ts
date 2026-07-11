import type { ExecRunner } from "./pr-preview/exec.ts";

/** Outcome of a dependency install. `ok: false` carries a user-facing reason. */
export interface InstallResult {
  readonly ok: boolean;
  readonly reason?: string;
}

/**
 * Reconcile the repo's `node_modules` with the committed lockfile before a dev
 * instance starts, so a developer who just pulled a Renovate lock-file refresh
 * boots against the current dependency set instead of a stale tree.
 *
 * Uses `--frozen-lockfile` deliberately: it installs EXACTLY what `bun.lock`
 * pins and never rewrites the lockfile (a plain `bun install` re-serializes it
 * even on a no-op, dirtying the working tree on every launch). The trade-off is
 * that it fails when `package.json` has drifted from `bun.lock` - that is a real
 * signal surfaced to the user, not silently started against a mismatched tree.
 * (The PR-preview flow installs its own merged worktree separately, without
 * `--frozen-lockfile`, because a merge can legitimately change the manifest.)
 */
export async function installDependencies({
  exec,
  repoRoot,
  onStep,
}: {
  exec: ExecRunner;
  repoRoot: string;
  onStep: (message: string) => void;
}): Promise<InstallResult> {
  onStep("Installing dependencies (bun install --frozen-lockfile)...");
  const result = await exec.run({
    command: "bun",
    args: ["install", "--frozen-lockfile"],
    cwd: repoRoot,
  });
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    return {
      ok: false,
      reason:
        `bun install --frozen-lockfile failed (exit ${result.code}).\n` +
        `The lockfile is likely out of sync with package.json - run \`bun install\` to update it.\n\n` +
        detail,
    };
  }
  onStep("Dependencies are up to date.");
  return { ok: true };
}
