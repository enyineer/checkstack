import process from "node:process";
import { createSupervisor } from "../dev-tui/supervisor.ts";
import { runPlainStreaming } from "../dev-tui/plain-runner.ts";
import { createBunExec } from "./pr-preview/exec.ts";
import { listOpenPrs, resolvePrSelection } from "./pr-preview/gh-prs.ts";
import { preparePreview } from "./pr-preview/prepare.ts";
import type { CockpitArgs } from "./args.ts";

/**
 * Non-TTY dev runner: stream the primary dev instance's output with source
 * prefixes (no ink/opentui raw mode). Mirrors the previous `dev` plain fallback.
 */
export function runPlainDev({
  repoRoot,
  args,
  onShutdownComplete,
}: {
  repoRoot: string;
  args: CockpitArgs;
  onShutdownComplete: () => void;
}): void {
  const supervisor = createSupervisor({ cwd: repoRoot, mode: args.devMode });
  runPlainStreaming({ supervisor, onShutdownComplete });
}

/**
 * Non-TTY PR-preview runner (the agent-facing path): resolve `--prs`, prepare
 * the merged worktree + db snapshot, then stream the preview instance. The
 * snapshot is KEPT on exit (wipe only via `--wipe`/`--fresh`). Requires
 * `args.prNumbers`; a non-TTY session cannot use the interactive picker.
 */
export async function runPlainPreview({
  repoRoot,
  args,
  write = (text: string) => process.stdout.write(`${text}\n`),
  onShutdownComplete,
}: {
  repoRoot: string;
  args: CockpitArgs;
  write?: (text: string) => void;
  onShutdownComplete: () => void;
}): Promise<void> {
  const exec = createBunExec();
  const requested = args.prNumbers ?? [];
  if (requested.length === 0) {
    write(
      "Non-interactive PR preview requires --prs <numbers> (e.g. --prs 380,381).",
    );
    process.exit(1);
  }

  const prs = await listOpenPrs({ exec });
  const { selected, invalid } = resolvePrSelection({ requested, available: prs });
  if (invalid.length > 0) {
    write(
      `Not open PRs: ${invalid.join(", ")}. Open PRs: ${prs.map((p) => p.number).join(", ")}`,
    );
    process.exit(1);
  }

  const result = await preparePreview({
    exec,
    repoRoot,
    selected,
    namespace: args.namespace,
    fresh: args.fresh,
    onStep: write,
  });
  if (!result.ok) {
    write(`Preview preparation failed: ${result.reason}`);
    process.exit(1);
  }

  write(
    `Preview ready: PRs ${selected.map((p) => `#${p.number}`).join(", ")} at http://localhost:${result.vitePort}`,
  );
  const supervisor = createSupervisor({
    cwd: result.worktreePath,
    defs: result.defs,
  });
  runPlainStreaming({ supervisor, onShutdownComplete });
}
