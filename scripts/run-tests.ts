#!/usr/bin/env bun
/**
 * Run the whole unit-test suite, green, fast, and WITHOUT cooking the machine.
 *
 * ## The problem this solves
 *
 * A bare `bun test` loads every file into ONE process sharing one module
 * registry, so a file that mutates process globals leaks into later files and
 * the run is flaky. The previous fix was `bun test --parallel` (implies
 * `--isolate`): every file re-evaluates the imported module graph in its own
 * fresh global/worker. Correct, but brutally expensive - ~1000 files x a full
 * re-parse of drizzle/oRPC/testing-library, ~11 min at full CPU on all cores,
 * which thermally throttles laptops and starves timers enough to flake.
 *
 * ## What actually needs isolation (measured, not assumed)
 *
 * Empirically (see the tmp experiments that produced this partition), the
 * shared single-process run is GREEN for the whole backend once a small,
 * greppable set is pulled out. Bun 1.3.14 runs files strictly sequentially
 * (file A's afterAll completes before file B evaluates) and auto-resets spies,
 * in-test module mocks, and global assignments BETWEEN files. The only things
 * that leak across the file boundary - and therefore the only things that must
 * be isolated - are:
 *
 *   1. A top-level `mock.module(...)` (patches the shared module registry; not
 *      auto-reset).
 *   2. A `global`/`globalThis.X = ...` assignment (e.g. a test replacing global
 *      `fetch` - leaks a mocked fetch into every later real-HTTP test).
 *   3. A `spyOn(globalThis|global|window, ...)` (spying a GLOBAL object leaks;
 *      spying a local object does not).
 *   4. A top-level `process.env.X = ...` write.
 *   5. Frontend `.tsx` tests: `@happy-dom/global-registrator` installs global
 *      `document`/`window`/`fetch`/`Response` and never unregisters, so they
 *      cannot share a process with native backend tests, and they carry per-
 *      file DOM/focus state that leaks between each other. There are few of
 *      them and they run in ~1s, so isolating them is essentially free.
 *
 * Everything else - the vast majority - runs in ONE shared process: a single
 * module-graph parse, mostly one core, ~30s instead of ~11 min, and cool.
 *
 * ## Ink / yoga caveat (unchanged)
 *
 * `ink` pulls in `yoga-layout`, which CRASHES under `--isolate`
 * ("Cannot access 'Yoga' before initialization"). So ink files must ALWAYS run
 * in the shared (non-isolated) pass - which is now the default anyway. They
 * neither mock modules nor mutate globals, so they are safe there. The ink
 * check therefore takes precedence over the isolation heuristics below.
 *
 * Requires Bun >= 1.3.13. CI uses `bun-version: latest`.
 *
 * Excludes: core/e2e (Playwright specs) and *.it.test.ts (the CHECKSTACK_IT
 * integration lane). Extra args pass through to `bun test`
 * (e.g. `bun run test --bail`).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const passthroughArgs = process.argv.slice(2);

const allFiles = (
  spawnSync(
    "git",
    [
      "ls-files",
      // Include UNTRACKED (but not ignored) files: a brand-new package's tests
      // must run before anyone remembers to `git add` it, or the "full" suite
      // silently excludes exactly the newest work.
      "--cached",
      "--others",
      "--exclude-standard",
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
      !file.startsWith("core/e2e/") &&
      // `git ls-files` reads the INDEX: a tracked/staged file that was since
      // deleted or moved on disk (mid-refactor working tree) would otherwise
      // crash discovery with ENOENT. Run what actually exists.
      existsSync(file),
  );

// `ink` pulls in `yoga-layout`, which crashes under Bun's per-file isolation.
// Ink files must run in the shared (non-isolated) pass; this check wins over
// the isolation heuristic below.
const INK_IMPORT = /from\s+["'](ink|ink-testing-library|yoga-layout)/;

// A file must be ISOLATED (own fresh global) iff it leaks state across the
// shared-process file boundary. See the header for why each pattern leaks.
// Biased toward OVER-isolation: a false positive just runs one extra file
// isolated (a few ms), whereas a false negative lets a polluter into the
// shared pass and breaks a distant, innocent test. Kept in lock-step with the
// `no-shared-process-test-pollution` ESLint rule so authors are guided to a
// hygienic pattern instead of silently landing in the slow isolated pass.
const POLLUTES_SHARED_STATE =
  /(?:^|[^.\w])mock\.module\s*\(|(?:globalThis|global)\.[A-Za-z_$][\w$]*\s*=|^[ \t]*process\.env\.[A-Za-z_$][\w$]*\s*=|spyOn\s*\(\s*(?:globalThis|global|window)\b/m;

const shared: string[] = [];
const isolated: string[] = [];
for (const file of allFiles) {
  const src = readFileSync(file, "utf8");
  if (INK_IMPORT.test(src)) {
    shared.push(file); // ink: never isolate (yoga crash); safe in shared
    continue;
  }
  // Frontend (happy-dom) or a global-state polluter -> isolate.
  if (file.endsWith(".tsx") || POLLUTES_SHARED_STATE.test(src)) {
    isolated.push(file);
  } else {
    shared.push(file);
  }
}

// Default per-test timeout. Bun's built-in 5s default is too tight when a large
// suite runs on a loaded machine (timers/subprocess spawns get starved and
// healthy tests flake at ~5s). 30s changes NO assertion - it only stops
// treating scheduler starvation as a failure. (A bunfig `[test] timeout` is
// silently ignored by this bun version, so the flag lives here.) A caller-
// supplied --timeout in passthroughArgs wins because later flags override.
const DEFAULT_TIMEOUT_MS = 30_000;

function run(label: string, extraFlags: string[], files: string[]): boolean {
  console.log(`\n==> bun test ${label} (${files.length} files)`);
  return (
    spawnSync(
      "bun",
      [
        "test",
        "--timeout",
        String(DEFAULT_TIMEOUT_MS),
        ...extraFlags,
        ...files,
        ...passthroughArgs,
      ],
      { stdio: "inherit" },
    ).status === 0
  );
}

let ok = true;
// The bulk: ONE shared process, one module-graph parse, mostly single-core.
if (shared.length > 0) {
  ok = run("shared (1 process)", [], shared) && ok;
}
// The few polluters + frontend DOM tests: fresh global per file.
if (isolated.length > 0) {
  ok = run("isolated", ["--isolate"], isolated) && ok;
}

if (!ok) {
  console.error("\nTest failures (see output above).");
  process.exit(1);
}
console.log("\nAll tests passed.");
