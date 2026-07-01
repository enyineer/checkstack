import type { ExecCommand, ExecRunner } from "./exec.ts";

/**
 * A generated artifact that a merge conflict can be resolved by REGENERATION
 * rather than by hand: the generator rewrites the whole file deterministically
 * from the merged sources, so any conflict markers are overwritten. Each rule
 * maps matching conflict paths to the command that regenerates them.
 *
 * Restricted to files a generator OWNS end-to-end - never a hand-authored file
 * where regeneration could leave stray conflict markers.
 */
interface RegenRule {
  readonly label: string;
  matches(path: string): boolean;
  readonly command: ExecCommand;
}

const REGEN_RULES: readonly RegenRule[] = [
  {
    label: "docs-index",
    // e.g. core/ai-backend/src/generated/docs-index.ts
    matches: (p) => p.endsWith("docs-index.ts") || p.includes("/generated/"),
    command: { command: "bun", args: ["run", "generate:docs-index"] },
  },
  {
    label: "sdk",
    matches: (p) => p.startsWith("core/sdk/"),
    command: { command: "bun", args: ["run", "generate:sdk"] },
  },
  {
    label: "lockfile",
    matches: (p) => p === "bun.lock" || p.endsWith("/bun.lock"),
    command: { command: "bun", args: ["install"] },
  },
];

/** Parse `git diff --name-only --diff-filter=U` stdout into a path list. */
export function parseConflictedFiles(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** True when a conflicted path can be resolved by regenerating it. */
export function isRegenerablePath(path: string): boolean {
  return REGEN_RULES.some((rule) => rule.matches(path));
}

/** Split conflicted paths into regenerable ("generated") and hand-authored ("real"). */
export function classifyConflicts({
  conflictedPaths,
}: {
  conflictedPaths: readonly string[];
}): { generated: string[]; real: string[] } {
  const generated: string[] = [];
  const real: string[] = [];
  for (const path of conflictedPaths) {
    (isRegenerablePath(path) ? generated : real).push(path);
  }
  return { generated, real };
}

/**
 * Given regenerable conflict paths, return the DEDUPED set of regeneration
 * commands to run (in worktree order: docs-index, sdk, lockfile). Pure.
 */
export function planRegeneration({
  generatedPaths,
}: {
  generatedPaths: readonly string[];
}): ExecCommand[] {
  const commands: ExecCommand[] = [];
  for (const rule of REGEN_RULES) {
    if (generatedPaths.some((p) => rule.matches(p))) {
      commands.push(rule.command);
    }
  }
  return commands;
}

/** Per-PR merge status. */
export interface MergedBranchResult {
  readonly branch: string;
  readonly prNumber: number;
  /** How the merge resolved. */
  readonly status: "clean" | "regenerated" | "conflicted";
  /** Hand-authored conflicts that blocked the merge (only for "conflicted"). */
  readonly realConflicts?: string[];
}

export interface PrepareWorktreeInput {
  readonly exec: ExecRunner;
  /** Absolute path of the throwaway worktree. */
  readonly worktreePath: string;
  /** Base ref to branch the worktree from (e.g. "origin/main"). */
  readonly baseRef: string;
  /** Selected PRs' branch + number, applied in order. */
  readonly branches: readonly { prNumber: number; headRefName: string }[];
  /** Optional progress callback for the UI. */
  readonly onStep?: (message: string) => void;
}

export interface PrepareWorktreeResult {
  readonly results: MergedBranchResult[];
  /** True when every selected branch merged (clean or regenerated). */
  readonly ok: boolean;
}

async function run(
  exec: ExecRunner,
  command: ExecCommand,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const result = await exec.run(command);
  return { ok: result.code === 0, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Build a merged worktree: fetch, (re)create the worktree at `baseRef`, then
 * merge each selected branch in order. A merge whose ONLY conflicts are
 * regenerable artifacts is auto-resolved by regenerating them and committing;
 * a merge with hand-authored conflicts is aborted and reported. Stops at the
 * first branch with real conflicts so the user can resolve deliberately.
 *
 * The final `bun install` (deps for the merged tree) is the caller's
 * responsibility - it is a separate, slow step surfaced distinctly in the UI.
 */
export async function prepareWorktree({
  exec,
  worktreePath,
  baseRef,
  branches,
  onStep,
}: PrepareWorktreeInput): Promise<PrepareWorktreeResult> {
  const step = (m: string) => onStep?.(m);

  step("Fetching latest refs...");
  await run(exec, { command: "git", args: ["fetch", "origin", "--prune"] });

  // Recreate the worktree from a clean base. `remove --force` is a no-op-ish if
  // it does not exist (we ignore its result).
  step("Preparing worktree...");
  await run(exec, {
    command: "git",
    args: ["worktree", "remove", "--force", worktreePath],
  });
  const added = await run(exec, {
    command: "git",
    args: ["worktree", "add", "--detach", worktreePath, baseRef],
  });
  if (!added.ok) {
    throw new Error(
      `Failed to create worktree at ${worktreePath}:\n${added.stderr.trim()}`,
    );
  }

  const inWorktree = (command: ExecCommand): ExecCommand => ({
    ...command,
    cwd: worktreePath,
  });

  const results: MergedBranchResult[] = [];
  for (const { prNumber, headRefName } of branches) {
    step(`Merging #${prNumber} (${headRefName})...`);
    const merge = await run(
      exec,
      inWorktree({
        command: "git",
        args: ["merge", "--no-edit", `origin/${headRefName}`],
      }),
    );
    if (merge.ok) {
      results.push({ branch: headRefName, prNumber, status: "clean" });
      continue;
    }

    // Merge failed: inspect unmerged paths.
    const conflicts = await run(
      exec,
      inWorktree({
        command: "git",
        args: ["diff", "--name-only", "--diff-filter=U"],
      }),
    );
    const conflictedPaths = parseConflictedFiles(conflicts.stdout);
    const { generated, real } = classifyConflicts({ conflictedPaths });

    if (real.length > 0 || generated.length === 0) {
      // Hand-authored conflict (or an empty/opaque failure): abort and report.
      await run(
        exec,
        inWorktree({ command: "git", args: ["merge", "--abort"] }),
      );
      results.push({
        branch: headRefName,
        prNumber,
        status: "conflicted",
        realConflicts: real.length > 0 ? real : conflictedPaths,
      });
      return { results, ok: false };
    }

    // Only regenerable artifacts conflict: regenerate, stage, and commit.
    step(`Regenerating generated files for #${prNumber}...`);
    for (const command of planRegeneration({ generatedPaths: generated })) {
      await run(exec, inWorktree(command));
    }
    await run(exec, inWorktree({ command: "git", args: ["add", "-A"] }));
    const committed = await run(
      exec,
      inWorktree({ command: "git", args: ["commit", "--no-edit"] }),
    );
    if (!committed.ok) {
      await run(
        exec,
        inWorktree({ command: "git", args: ["merge", "--abort"] }),
      );
      results.push({
        branch: headRefName,
        prNumber,
        status: "conflicted",
        realConflicts: conflictedPaths,
      });
      return { results, ok: false };
    }
    results.push({ branch: headRefName, prNumber, status: "regenerated" });
  }

  return { results, ok: true };
}
