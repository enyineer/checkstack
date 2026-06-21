import { devices } from "@playwright/test";
import { createPlaywrightConfig } from "@checkstack/test-utils-frontend/playwright";
import {
  ADMIN_STORAGE_STATE,
  MEMBER_STORAGE_STATE,
} from "./tests/support/auth";

/**
 * App-wide end-to-end tests (authenticated), BOOT-ONCE model.
 *
 * The harness boots its OWN backend on port 3100 via `scripts/start-e2e-server.ts`
 * exactly ONCE per run (resets a dedicated `checkstack_e2e` DB, runs real
 * better-auth, serves the built SPA + docs same-origin). All specs then run
 * against that single backend, in PARALLEL (`workers`), instead of the old
 * model that rebooted the backend + reset the DB per spec file.
 *
 * That works because every spec is DATA-ISOLATED: it namespaces the entities it
 * creates (unique suffix) and never asserts global/whole-DB state. So parallel
 * specs don't collide, and an in-process retry just re-creates its own
 * namespaced data on the shared DB - retries are safe again (no per-file reboot
 * needed).
 *
 * Projects / ordering (Playwright project dependencies enforce the order):
 *  - `setup-admin` (auth.setup.ts): first-run onboarding, persists the admin
 *    session. `setup-member` self-registers a non-admin for the permissions spec.
 *  - `empty-state` (`*.empty.spec.ts`): the onboarding / "fresh install" /
 *    empty-state assertions. They depend on a PRISTINE DB, so they run AFTER
 *    onboarding but BEFORE any data spec (the `chromium` project depends on this
 *    project), and they create nothing - keeping the DB pristine through this
 *    phase.
 *  - `chromium`: every data-isolated `*.spec.ts` (except setup / permissions /
 *    *.empty), run in parallel as the admin, AFTER `empty-state`.
 *  - `member`: the permissions spec as the non-admin.
 *
 * CI shards with Playwright's native `--shard=i/N` (see the e2e workflow); each
 * shard boots once and runs its slice in parallel.
 *
 * Lower-level entrypoints (Postgres + build already provided):
 *  - `bun run test:e2e:file` (`playwright test`) - run a single spec.
 */
export default createPlaywrightConfig({
  baseURL: "http://localhost:3100",
  testDir: "./tests",
  overrides: {
    // Specs are data-isolated, so a retry safely re-creates its own namespaced
    // data on the shared DB - normal in-process retries are fine again.
    retries: process.env.CI ? 2 : 0,
    // Parallel across the single shared backend - the whole point of boot-once.
    fullyParallel: true,
    workers: process.env.CHECKSTACK_E2E_WORKERS
      ? Number(process.env.CHECKSTACK_E2E_WORKERS)
      : process.env.CI
        ? 4
        : undefined,
    projects: [
      {
        name: "setup-admin",
        testMatch: /auth\.setup\.ts$/,
        use: { ...devices["Desktop Chrome"] },
      },
      {
        // Self-registers a non-admin AFTER the admin exists.
        name: "setup-member",
        testMatch: /member\.setup\.ts$/,
        use: { ...devices["Desktop Chrome"] },
        dependencies: ["setup-admin"],
      },
      {
        // Onboarding / empty-state assertions: need a PRISTINE DB, so they run
        // after onboarding and before any data spec (chromium depends on this).
        // These specs create nothing, leaving the DB pristine through the phase.
        name: "empty-state",
        testMatch: /\.empty\.spec\.ts$/,
        use: {
          ...devices["Desktop Chrome"],
          storageState: ADMIN_STORAGE_STATE,
        },
        dependencies: ["setup-admin"],
      },
      {
        // Every data-isolated spec, parallel, as the admin, AFTER the pristine
        // empty-state phase has finished.
        name: "chromium",
        testIgnore: [
          /.*\.setup\.ts$/,
          /permissions\.spec\.ts$/,
          /\.empty\.spec\.ts$/,
        ],
        use: {
          ...devices["Desktop Chrome"],
          storageState: ADMIN_STORAGE_STATE,
        },
        dependencies: ["empty-state"],
      },
      {
        // Non-admin actor: the permissions spec with the member's session.
        name: "member",
        testMatch: /permissions\.spec\.ts$/,
        use: {
          ...devices["Desktop Chrome"],
          storageState: MEMBER_STORAGE_STATE,
        },
        dependencies: ["setup-member"],
      },
    ],
    webServer: {
      command: "bun --env-file=.env core/e2e/scripts/start-e2e-server.ts",
      cwd: "../../",
      url: "http://localhost:3100/.checkstack/ready",
      timeout: 180_000,
      reuseExistingServer: false,
    },
  },
});
