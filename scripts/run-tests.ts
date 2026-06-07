#!/usr/bin/env bun
/**
 * Run the whole unit-test suite, green and fast.
 *
 * A bare `bun test` over the repo loads every file into ONE process, so a
 * process-global `mock.module()` / `globalThis` mutation in any file leaks into
 * unrelated suites and the run is flaky. Bun 1.3.13+ fixes this natively with
 * `--parallel` (test files run across worker processes, isolated between
 * files), so the bulk of the suite uses it - fast and properly isolated.
 *
 * The one exception: `--parallel`/`--isolate` re-evaluate each file in a fresh
 * global, which currently trips `yoga-layout` (pulled in by `ink`) with
 * "Cannot access 'Yoga' before initialization" - an experimental Bun bug, not
 * our code. So the few ink-importing TUI test files run in a separate PLAIN
 * pass (no isolation), which is safe: they neither mock modules nor mutate
 * globals, so they cannot pollute anything.
 *
 * Requires Bun >= 1.3.13 (for `--parallel`). CI uses `bun-version: latest`.
 *
 * Excludes: core/e2e (Playwright specs) and *.it.test.ts (the CHECKSTACK_IT
 * integration lane). Extra args pass through to `bun test`
 * (e.g. `bun run test --bail`).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const passthroughArgs = process.argv.slice(2);

const allFiles = (
  spawnSync(
    "git",
    [
      "ls-files",
      "core/*.test.ts",
      "core/*.test.tsx",
      "plugins/*.test.ts",
      "plugins/*.test.tsx",
      "scripts/*.test.ts",
      "scripts/*.test.tsx",
    ],
    { encoding: "utf8" },
  ).stdout ?? ""
)
  .split("\n")
  .map((file) => file.trim())
  .filter(
    (file) =>
      file.length > 0 &&
      !file.includes(".it.test.") &&
      !file.startsWith("core/e2e/"),
  );

// `ink` imports `yoga-layout`, which crashes under Bun's per-file isolation.
// Detect those files so they can run in a plain (non-isolated) pass instead of
// hard-coding paths that drift as TUI tests are added.
const INK_IMPORT = /from\s+["'](ink|ink-testing-library|yoga-layout)/;
const inkFiles = new Set(
  allFiles.filter((file) => INK_IMPORT.test(readFileSync(file, "utf8"))),
);
const parallelFiles = allFiles.filter((file) => !inkFiles.has(file));

function run(label: string, args: string[]): boolean {
  console.log(`\n==> bun test ${label} (${args.filter((a) => a.endsWith(".tsx") || a.endsWith(".ts")).length} files)`);
  return (
    spawnSync("bun", ["test", ...args, ...passthroughArgs], {
      stdio: "inherit",
    }).status === 0
  );
}

let ok = true;
if (parallelFiles.length > 0) {
  ok = run("--parallel", ["--parallel", ...parallelFiles]) && ok;
}
if (inkFiles.size > 0) {
  // Plain pass: the ink/yoga TUI files (see header). No --parallel/--isolate.
  ok = run("ink/TUI (plain)", [...inkFiles]) && ok;
}

if (!ok) {
  console.error("\nTest failures (see output above).");
  process.exit(1);
}
console.log("\nAll tests passed.");
