#!/usr/bin/env bun
/**
 * Run each workspace package's unit tests in its OWN bun process.
 *
 * `bun test` over the whole repo loads every matched file into a SINGLE
 * process. A process-global `mock.module()`, a `globalThis` mutation, or an
 * accumulating real-HTTP server / ink TUI renderer in any one file can then
 * break unrelated suites - so the raw whole-repo `bun test` is flaky by Bun's
 * design. CI (`.github/workflows/pr-checks.yml`) runs each package in its own
 * process for exactly this reason; this script mirrors that so `bun run test`
 * is green and deterministic locally too. It runs EVERY unit test - nothing is
 * skipped.
 *
 * Excluded:
 *  - `core/e2e` (Playwright specs, run by `playwright test`).
 *  - `*.it.test.ts` integration tests (their own `CHECKSTACK_IT` lane).
 *
 * Pass extra args through to `bun test` (e.g. `bun run test --bail`).
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const passthroughArgs = process.argv.slice(2);

function packageDirs(root: "core" | "plugins"): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${root}/${entry.name}`);
}

const dirs = [
  ...packageDirs("core"),
  ...packageDirs("plugins"),
  "scripts",
].filter((dir) => dir !== "core/e2e");

const failed: string[] = [];

for (const dir of dirs) {
  const listed = spawnSync(
    "git",
    ["ls-files", `${dir}/*.test.ts`, `${dir}/*.test.tsx`],
    { encoding: "utf8" },
  );
  const files = (listed.stdout ?? "")
    .split("\n")
    .map((file) => file.trim())
    .filter((file) => file.length > 0 && !file.includes(".it.test."));

  if (files.length === 0) continue;

  console.log(`\n==> bun test ${dir}`);
  const result = spawnSync("bun", ["test", ...files, ...passthroughArgs], {
    stdio: "inherit",
  });
  if (result.status !== 0) failed.push(dir);
}

if (failed.length > 0) {
  console.error(`\nTest failures in: ${failed.join(", ")}`);
  process.exit(1);
}

console.log("\nAll package test suites passed.");
