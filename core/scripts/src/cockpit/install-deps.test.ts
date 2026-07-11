import { describe, expect, it } from "bun:test";
import type { ExecCommand, ExecResult, ExecRunner } from "./pr-preview/exec.ts";
import { installDependencies } from "./install-deps.ts";

const cmdOf = (c: ExecCommand) => `${c.command} ${c.args.join(" ")}`;

function fakeExec(responder: (c: ExecCommand) => Partial<ExecResult>): {
  exec: ExecRunner;
  calls: ExecCommand[];
} {
  const calls: ExecCommand[] = [];
  return {
    calls,
    exec: {
      run(command) {
        calls.push(command);
        const r = responder(command);
        return Promise.resolve({
          code: r.code ?? 0,
          stdout: r.stdout ?? "",
          stderr: r.stderr ?? "",
        });
      },
    },
  };
}

describe("installDependencies", () => {
  it("runs a frozen-lockfile install in the repo root and reports steps", async () => {
    const { exec, calls } = fakeExec(() => ({ code: 0 }));
    const steps: string[] = [];
    const result = await installDependencies({
      exec,
      repoRoot: "/repo",
      onStep: (m) => steps.push(m),
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(cmdOf(calls[0])).toBe("bun install --frozen-lockfile");
    expect(calls[0].cwd).toBe("/repo");
    expect(steps[0]).toContain("Installing dependencies");
    expect(steps.at(-1)).toContain("up to date");
  });

  it("never uses a plain install (which would rewrite the lockfile)", async () => {
    const { exec, calls } = fakeExec(() => ({ code: 0 }));
    await installDependencies({ exec, repoRoot: "/repo", onStep: () => {} });
    expect(calls[0].args).toContain("--frozen-lockfile");
  });

  it("fails with a lockfile-drift hint when the install exits non-zero", async () => {
    const { exec } = fakeExec(() => ({ code: 1, stderr: "lockfile had changes" }));
    const result = await installDependencies({ exec, repoRoot: "/repo", onStep: () => {} });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("out of sync");
    expect(result.reason).toContain("lockfile had changes");
  });
});
