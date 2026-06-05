import { spawnSync } from "node:child_process";

/**
 * Initialise a git repo in `dir` and make an initial commit.
 *
 * Runs in the thin CLI shell only (never the shared engine), so the
 * in-monorepo `create` path is unaffected. Failures are non-fatal: a
 * generated repo without git is still usable, so we warn and continue.
 */
export function initGitRepo({
  dir,
  log = console.log,
  warn = console.warn,
}: {
  dir: string;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}): boolean {
  const steps: { args: string[]; label: string }[] = [
    { args: ["init"], label: "git init" },
    { args: ["add", "-A"], label: "git add" },
    {
      args: ["commit", "-m", "chore: scaffold plugin with create-checkstack-plugin"],
      label: "git commit",
    },
  ];

  for (const { args, label } of steps) {
    const result = spawnSync("git", args, { cwd: dir, stdio: "ignore" });
    if (result.status !== 0) {
      warn(
        `Skipped git setup (${label} failed). Initialise git manually if you want version control.`,
      );
      return false;
    }
  }
  log("Initialised a git repository with an initial commit.");
  return true;
}
