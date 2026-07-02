import fs from "node:fs";
import path from "node:path";
import type { ExecRunner } from "./exec.ts";
import type { PrInfo } from "./gh-prs.ts";
import {
  buildPreviewDatabaseUrl,
  ensureSnapshot,
  resolveDbCopyConfig,
} from "./db-copy.ts";
import { DEFAULT_DEV_PORTS, pickFreePorts } from "./ports.ts";
import {
  prepareWorktree,
  type MergedBranchResult,
} from "./merge-plan.ts";
import { buildPreviewProcessDefs } from "./process-defs.ts";
import { previewDataDir, worktreePath } from "./paths.ts";
import { writePreviewState } from "./state.ts";
import type { ProcessDef } from "../../dev-tui/process-config.ts";

export interface PreparePreviewInput {
  readonly exec: ExecRunner;
  readonly repoRoot: string;
  readonly selected: readonly PrInfo[];
  readonly namespace: string;
  readonly fresh: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly onStep?: (message: string) => void;
  /** Injected clock for a deterministic snapshot timestamp (defaults to now). */
  readonly now?: () => string;
}

export type PreparePreviewResult =
  | {
      readonly ok: true;
      readonly defs: ProcessDef[];
      readonly worktreePath: string;
      readonly backendPort: number;
      readonly vitePort: number;
      readonly previewDatabaseUrl: string;
      readonly mergeResults: MergedBranchResult[];
      readonly dbCreated: boolean;
    }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly mergeResults?: MergedBranchResult[];
    };

/**
 * Orchestrate the full preview preparation, shared by the interactive view and
 * the non-TTY runner: snapshot the db, pick ports, build+merge the worktree,
 * copy `.env` for secrets, install deps, and assemble the process defs. Every
 * step reports via `onStep`. All sub-steps are individually unit-tested; this
 * function is the glue plus fs work (copy `.env`, persist state).
 */
export async function preparePreview({
  exec,
  repoRoot,
  selected,
  namespace,
  fresh,
  env = process.env,
  onStep,
  now = () => new Date().toISOString(),
}: PreparePreviewInput): Promise<PreparePreviewResult> {
  const step = (m: string) => onStep?.(m);

  const dbConfig = resolveDbCopyConfig({
    env,
    previewDbName: `checkstack_${namespace}`,
  });
  step("Ensuring database snapshot...");
  const { created } = await ensureSnapshot({
    exec,
    config: dbConfig,
    fresh,
    onStep,
  });
  const previewDatabaseUrl = buildPreviewDatabaseUrl({
    databaseUrl: dbConfig.databaseUrl,
    previewDb: dbConfig.previewDb,
  });

  step("Selecting free ports...");
  const [backendPort, vitePort] = await pickFreePorts({
    count: 2,
    exclude: DEFAULT_DEV_PORTS,
  });
  if (backendPort === undefined || vitePort === undefined) {
    return { ok: false, reason: "Could not allocate free ports" };
  }

  const wt = worktreePath(repoRoot);
  const merge = await prepareWorktree({
    exec,
    worktreePath: wt,
    baseRef: "origin/main",
    branches: selected.map((pr) => ({
      prNumber: pr.number,
      headRefName: pr.headRefName,
    })),
    onStep,
  });
  if (!merge.ok) {
    const conflicted = merge.results.find((r) => r.status === "conflicted");
    return {
      ok: false,
      reason: conflicted
        ? `Merge of #${conflicted.prNumber} (${conflicted.branch}) has conflicts that need manual resolution: ${(conflicted.realConflicts ?? []).join(", ")}`
        : "Failed to prepare the merged worktree",
      mergeResults: merge.results,
    };
  }

  // Copy the root .env into the worktree so the preview backend loads the same
  // secrets (encryption key etc.); our per-process env overrides still win.
  const rootEnv = path.join(repoRoot, ".env");
  if (fs.existsSync(rootEnv)) {
    step("Copying .env into worktree...");
    fs.copyFileSync(rootEnv, path.join(wt, ".env"));
  }

  step("Installing dependencies in worktree (bun install)...");
  const install = await exec.run({
    command: "bun",
    args: ["install"],
    cwd: wt,
  });
  if (install.code !== 0) {
    return {
      ok: false,
      reason: `bun install failed in the worktree:\n${install.stderr.trim()}`,
      mergeResults: merge.results,
    };
  }

  // Seed an isolated script-package store from the dev instance so the preview
  // reuses already-built package trees instead of a cold `bun install --offline`
  // reconcile (which fails against a fresh store).
  const dataDir = previewDataDir(repoRoot);
  await seedPreviewDataDir({ exec, repoRoot, dataDir, fresh, onStep });

  const defs = buildPreviewProcessDefs({
    backendPort,
    vitePort,
    previewDatabaseUrl,
    namespace,
    dataDir,
  });

  writePreviewState({
    repoRoot,
    state: {
      snapshotAt: now(),
      mergedPrs: selected.map((pr) => pr.number),
      worktreePath: wt,
    },
  });

  return {
    ok: true,
    defs,
    worktreePath: wt,
    backendPort,
    vitePort,
    previewDatabaseUrl,
    mergeResults: merge.results,
    dbCreated: created,
  };
}

/**
 * Seed the preview's isolated script-package store from the dev instance's
 * `.data/script-packages`, so the preview backend's startup reconcile finds the
 * trees already built (a no-op) instead of running a cold `bun install
 * --offline` against an empty store. Best-effort: if there is nothing to copy or
 * the copy fails, the preview backend simply reconciles from the copied blobs.
 * Reuses an existing seed unless `fresh`.
 */
async function seedPreviewDataDir({
  exec,
  repoRoot,
  dataDir,
  fresh,
  onStep,
}: {
  exec: ExecRunner;
  repoRoot: string;
  dataDir: string;
  fresh: boolean;
  onStep?: (message: string) => void;
}): Promise<void> {
  const devStore = path.join(repoRoot, ".data", "script-packages");
  if (!fs.existsSync(devStore)) return; // script-packages unused; nothing to seed
  const destStore = path.join(dataDir, "script-packages");
  if (fs.existsSync(destStore) && !fresh) {
    onStep?.("Reusing preview package store.");
    return;
  }
  onStep?.("Seeding preview package store from dev...");
  fs.rmSync(destStore, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
  // Reflink copy on macOS (APFS clone is near-instant); plain recursive copy
  // elsewhere. `cp -R <src> <dest>` (dest absent) copies src AS dest, preserving
  // the relative `current` symlink.
  const cloneArgs = process.platform === "darwin" ? ["-Rc"] : ["-R"];
  const copied = await exec.run({
    command: "cp",
    args: [...cloneArgs, devStore, destStore],
  });
  if (copied.code !== 0) {
    const fallback = await exec.run({
      command: "cp",
      args: ["-R", devStore, destStore],
    });
    if (fallback.code !== 0) {
      onStep?.(
        `Could not seed package store (${fallback.stderr.trim()}); preview will rebuild it.`,
      );
    }
  }
}
