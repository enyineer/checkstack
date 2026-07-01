import { afterAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExecCommand, ExecResult, ExecRunner } from "./exec.ts";
import { preparePreview } from "./prepare.ts";
import type { PrInfo } from "./gh-prs.ts";
import { readPreviewState } from "./state.ts";
import { worktreePath } from "./paths.ts";

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

const pr: PrInfo = {
  number: 380,
  title: "x",
  headRefName: "feat/a",
  isDraft: false,
  updatedAt: "2026-07-01T00:00:00Z",
};

describe("preparePreview (happy path)", () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pr-preview-prep-"));
  fs.writeFileSync(path.join(repoRoot, ".env"), "SECRET=1\n");

  afterAll(() => fs.rmSync(repoRoot, { recursive: true, force: true }));

  it("snapshots, merges, installs, and returns startable defs + state", async () => {
    // Simulate the side effect of `git worktree add` (the fake exec cannot).
    fs.mkdirSync(worktreePath(repoRoot), { recursive: true });
    // No snapshot exists -> create; merges clean; install succeeds.
    const { exec, calls } = fakeExec(() => ({ code: 0, stdout: "" }));
    const result = await preparePreview({
      exec,
      repoRoot,
      selected: [pr],
      namespace: "preview",
      fresh: false,
      env: { DATABASE_URL: "postgres://c:c@localhost:5432/checkstack" },
      now: () => "2026-07-01T12:00:00Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.previewDatabaseUrl).toBe(
      "postgres://c:c@localhost:5432/checkstack_preview",
    );
    // backend def carries the preview db + namespace.
    const backend = result.defs.find((d) => d.id === "backend");
    expect(backend?.env?.CHECKSTACK_INSTANCE_NAMESPACE).toBe("preview");
    expect(backend?.env?.DATABASE_URL).toBe(result.previewDatabaseUrl);

    // The worktree got its own .env copy and a bun install.
    expect(fs.existsSync(path.join(result.worktreePath, ".env"))).toBe(true);
    expect(calls.map(cmdOf)).toContain("bun install");

    // State was persisted.
    const state = readPreviewState({ repoRoot });
    expect(state.mergedPrs).toEqual([380]);
    expect(state.snapshotAt).toBe("2026-07-01T12:00:00Z");
  });

  it("returns a clear error on a real merge conflict", async () => {
    const { exec } = fakeExec((c) => {
      if (cmdOf(c) === "git merge --no-edit origin/feat/a") return { code: 1 };
      if (c.args.join(" ") === "diff --name-only --diff-filter=U") {
        return { code: 0, stdout: "core/backend/src/index.ts\n" };
      }
      return { code: 0 };
    });
    const result = await preparePreview({
      exec,
      repoRoot,
      selected: [pr],
      namespace: "preview",
      fresh: false,
      env: { DATABASE_URL: "postgres://c:c@localhost:5432/checkstack" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("#380");
    expect(result.reason).toContain("core/backend/src/index.ts");
  });
});
