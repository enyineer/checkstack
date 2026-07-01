import { describe, expect, it } from "bun:test";
import type { ExecCommand, ExecResult, ExecRunner } from "./exec.ts";
import {
  classifyConflicts,
  isRegenerablePath,
  parseConflictedFiles,
  planRegeneration,
  prepareWorktree,
} from "./merge-plan.ts";

describe("parseConflictedFiles", () => {
  it("splits, trims and drops blanks", () => {
    expect(parseConflictedFiles("a.ts\n  b.ts \n\n")).toEqual(["a.ts", "b.ts"]);
  });
});

describe("isRegenerablePath / classifyConflicts", () => {
  it("treats generated docs-index, sdk and lockfile as regenerable", () => {
    expect(
      isRegenerablePath("core/ai-backend/src/generated/docs-index.ts"),
    ).toBe(true);
    expect(isRegenerablePath("core/sdk/src/client.ts")).toBe(true);
    expect(isRegenerablePath("bun.lock")).toBe(true);
  });

  it("treats hand-authored source as a real conflict", () => {
    expect(isRegenerablePath("core/backend/src/index.ts")).toBe(false);
  });

  it("splits mixed conflicts into generated and real", () => {
    const { generated, real } = classifyConflicts({
      conflictedPaths: [
        "core/ai-backend/src/generated/docs-index.ts",
        "core/backend/src/index.ts",
      ],
    });
    expect(generated).toEqual(["core/ai-backend/src/generated/docs-index.ts"]);
    expect(real).toEqual(["core/backend/src/index.ts"]);
  });
});

describe("planRegeneration", () => {
  it("returns deduped commands for the matched generators", () => {
    const commands = planRegeneration({
      generatedPaths: [
        "core/ai-backend/src/generated/docs-index.ts",
        "bun.lock",
      ],
    });
    expect(commands.map((c) => c.args.join(" "))).toEqual([
      "run generate:docs-index",
      "install",
    ]);
  });
});

/** A fake ExecRunner that records every command and replies from a script. */
function fakeExec(
  responder: (command: ExecCommand) => Partial<ExecResult>,
): { exec: ExecRunner; calls: ExecCommand[] } {
  const calls: ExecCommand[] = [];
  const exec: ExecRunner = {
    run(command) {
      calls.push(command);
      const r = responder(command);
      return Promise.resolve({
        code: r.code ?? 0,
        stdout: r.stdout ?? "",
        stderr: r.stderr ?? "",
      });
    },
  };
  return { exec, calls };
}

const cmdOf = (c: ExecCommand) => `${c.command} ${c.args.join(" ")}`;

describe("prepareWorktree", () => {
  it("merges cleanly and marks each branch clean", async () => {
    const { exec, calls } = fakeExec(() => ({ code: 0 }));
    const result = await prepareWorktree({
      exec,
      worktreePath: "/tmp/wt",
      baseRef: "origin/main",
      branches: [{ prNumber: 380, headRefName: "feat/a" }],
    });
    expect(result.ok).toBe(true);
    expect(result.results[0]?.status).toBe("clean");
    // worktree was (re)created and the branch merged
    expect(calls.map(cmdOf)).toContain("git worktree add --detach /tmp/wt origin/main");
    expect(calls.map(cmdOf)).toContain("git merge --no-edit origin/feat/a");
  });

  it("auto-resolves a generated-only conflict by regenerating and committing", async () => {
    const { exec, calls } = fakeExec((c) => {
      if (cmdOf(c) === "git merge --no-edit origin/feat/a") return { code: 1 };
      if (c.args.join(" ") === "diff --name-only --diff-filter=U") {
        return { code: 0, stdout: "core/ai-backend/src/generated/docs-index.ts\n" };
      }
      return { code: 0 };
    });
    const result = await prepareWorktree({
      exec,
      worktreePath: "/tmp/wt",
      baseRef: "origin/main",
      branches: [{ prNumber: 380, headRefName: "feat/a" }],
    });
    expect(result.ok).toBe(true);
    expect(result.results[0]?.status).toBe("regenerated");
    const ran = calls.map(cmdOf);
    expect(ran).toContain("bun run generate:docs-index");
    expect(ran).toContain("git add -A");
    expect(ran).toContain("git commit --no-edit");
  });

  it("aborts and reports a real conflict, stopping further merges", async () => {
    const { exec, calls } = fakeExec((c) => {
      if (cmdOf(c) === "git merge --no-edit origin/feat/a") return { code: 1 };
      if (c.args.join(" ") === "diff --name-only --diff-filter=U") {
        return { code: 0, stdout: "core/backend/src/index.ts\n" };
      }
      return { code: 0 };
    });
    const result = await prepareWorktree({
      exec,
      worktreePath: "/tmp/wt",
      baseRef: "origin/main",
      branches: [
        { prNumber: 380, headRefName: "feat/a" },
        { prNumber: 381, headRefName: "feat/b" },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.status).toBe("conflicted");
    expect(result.results[0]?.realConflicts).toEqual(["core/backend/src/index.ts"]);
    const ran = calls.map(cmdOf);
    expect(ran).toContain("git merge --abort");
    // second branch was never attempted
    expect(ran).not.toContain("git merge --no-edit origin/feat/b");
  });
});
