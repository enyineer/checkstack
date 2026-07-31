/**
 * Root-scoped DOM cleanup for repo-root `bun test` runs.
 *
 * ## The bug this closes
 *
 * `setup.ts` registers `afterEach(cleanup)` at MODULE scope. That is correct
 * when the module is PRELOADED (see `core/ui/bunfig.toml`): a preload's hooks
 * land at the process root, so they apply to every file in the run.
 *
 * It silently does NOT work when a test file merely `import`s the setup. The
 * module is evaluated ONCE per process, so the hook is scoped to whichever file
 * imported it FIRST; every later frontend file in that process then runs with
 * no cleanup at all, and its renders accumulate in `document.body` for the rest
 * of the run.
 *
 * Nothing fails at the leak site - the damage lands on some unrelated file
 * whose query happens to match two elements. `Tabs.test.tsx` (five renders of
 * the same two tab labels) was the first to collide, failing with "Found
 * multiple elements with the role tab" ONLY in the repo-root run while passing
 * on its own. That is the signature of this class of bug: it moves as files are
 * added, and it blames the wrong file.
 *
 * The repo-root run is the one that matters here - CI tests each workspace
 * package with a root-cwd `bun test <files>`, and `scripts/run-tests.ts` drives
 * its shared pass the same way - so both read THIS bunfig. Registering the hook
 * at root scope restores per-file cleanup for every frontend test regardless of
 * import order.
 *
 * ## Why backend tests are unaffected
 *
 * Every test process in the repo loads this preload, so it must cost nothing
 * without a DOM. The `document` check short-circuits BEFORE the dynamic import,
 * so a process with no happy-dom registered never pulls in react-dom or
 * testing-library.
 *
 * Running alongside `setup.ts`'s own hook (package-scoped runs preload both) is
 * harmless: `cleanup()` is idempotent, and unmounting an already-unmounted tree
 * is a no-op.
 */
import { afterEach } from "bun:test";

afterEach(async () => {
  if (!("document" in globalThis)) return;
  const { cleanup } = await import("@testing-library/react");
  cleanup();
});
