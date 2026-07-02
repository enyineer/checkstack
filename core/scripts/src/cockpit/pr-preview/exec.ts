import { spawn } from "node:child_process";

/** The outcome of running a single command to completion. */
export interface ExecResult {
  /** Process exit code (0 = success). `null` maps to -1 for a killed process. */
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** One command to run: an executable plus its arguments and spawn options. */
export interface ExecCommand {
  readonly command: string;
  readonly args: readonly string[];
  /** Working directory; defaults to the current process cwd. */
  readonly cwd?: string;
  /** Extra env merged over the parent environment. */
  readonly env?: Readonly<Record<string, string>>;
  /** Optional stdin fed to the process (e.g. SQL piped to `psql`). */
  readonly input?: string;
}

/**
 * A runner for one-shot commands. Abstracted behind an interface so the
 * PR-preview logic (gh queries, git worktree/merge, docker/psql db copy) can be
 * driven by a FAKE runner in unit tests without spawning real processes.
 */
export interface ExecRunner {
  run(command: ExecCommand): Promise<ExecResult>;
}

/**
 * The real runner, backed by `node:child_process`. Captures stdout/stderr fully
 * (these commands are short-lived: `gh pr list`, `git merge`, `pg_dump`), and
 * never inherits stdio so it cannot corrupt the TUI's alternate screen.
 */
export function createBunExec(): ExecRunner {
  return {
    run({ command, args, cwd, env, input }: ExecCommand): Promise<ExecResult> {
      return new Promise((resolve, reject) => {
        const child = spawn(command, [...args], {
          cwd,
          env: env ? { ...process.env, ...env } : process.env,
          stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf8");
        });
        child.stderr?.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
        });
        child.on("error", reject);
        child.on("close", (code) => {
          resolve({ code: code ?? -1, stdout, stderr });
        });
        if (input !== undefined) {
          child.stdin?.write(input);
        }
        child.stdin?.end();
      });
    },
  };
}
