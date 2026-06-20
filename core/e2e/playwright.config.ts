import { devices } from "@playwright/test";
import { createPlaywrightConfig } from "@checkstack/test-utils-frontend/playwright";
import {
  ADMIN_STORAGE_STATE,
  MEMBER_STORAGE_STATE,
} from "./tests/support/auth";

/**
 * App-wide end-to-end tests (authenticated).
 *
 * The harness boots its OWN backend on port 3100 via `scripts/start-e2e-server.ts`,
 * which:
 *  - resets a DEDICATED, isolated Postgres database (`checkstack_e2e`) so tests
 *    never touch the developer's working data, and start from a clean schema;
 *  - runs the REAL auth stack (better-auth) - NOT dev-auth - so the login /
 *    session path is exercised exactly as in production;
 *  - serves the built SPA + docs same-origin on the dedicated port.
 *
 * Authentication (two actors):
 *  - `setup-admin` (`auth.setup.ts`) drives the first-run onboarding once,
 *    creating an admin + signing in, and persists to `ADMIN_STORAGE_STATE`. The
 *    main `chromium` project loads it so most specs run as an admin.
 *  - `setup-member` (`member.setup.ts`) runs AFTER `setup-admin` and
 *    self-registers a second, NON-admin member, persisting to
 *    `MEMBER_STORAGE_STATE`. The `member` project loads it and runs ONLY the
 *    permissions spec, so team-scoped visibility filtering is exercised through
 *    the UI as a non-admin (the UI counterpart to the `rpc.test.ts` G11 guard).
 *
 * Running the suite: `bun run test:e2e` (from `core/e2e`) is fully
 * self-contained - its `pretest` builds the frontend + docs, and
 * `with-e2e-postgres.ts` starts an ephemeral `postgres:16-alpine` via
 * Testcontainers and injects `DATABASE_URL`. The only prerequisite is a running
 * Docker daemon.
 *
 * The lower-level entrypoints below assume Postgres is ALREADY provided (via a
 * reachable `DATABASE_URL`) and the frontend + docs are already built:
 *  - `bun run test:e2e:file` (`playwright test`) - run a single spec.
 *  - `bun run test:e2e:no-db scripts/run-all.ts` - the runner without the
 *    Testcontainers wrapper, e.g. against an externally-managed Postgres.
 */
export default createPlaywrightConfig({
  baseURL: "http://localhost:3100",
  testDir: "./tests",
  overrides: {
    // No IN-PROCESS retries: `run-all.ts` retries a failed spec at the FILE
    // level instead, which re-boots the backend and resets the e2e DB so each
    // attempt starts clean. Playwright's per-test retries reuse the same
    // (now-polluted) DB, which is exactly what makes a serial group's
    // empty-state / create chain fail on retry. Setting 0 here avoids burning
    // those useless in-process retries before run-all re-runs on a fresh DB.
    retries: 0,
    // Override the factory's single default project to add a setup project (for
    // login) + the main authed project. The factory's top-level `use`
    // (baseURL/trace/screenshot) is inherited by both; we only add per-project
    // device + storageState here.
    projects: [
      {
        name: "setup-admin",
        testMatch: /auth\.setup\.ts$/,
        use: { ...devices["Desktop Chrome"] },
      },
      {
        // The member must self-register AFTER the admin exists, so this setup
        // depends on `setup-admin`.
        name: "setup-member",
        testMatch: /member\.setup\.ts$/,
        use: { ...devices["Desktop Chrome"] },
        dependencies: ["setup-admin"],
      },
      {
        // Main authed project: every spec EXCEPT the setup files and the
        // permissions spec, run as the admin.
        name: "chromium",
        testIgnore: [/.*\.setup\.ts$/, /permissions\.spec\.ts$/],
        use: {
          ...devices["Desktop Chrome"],
          storageState: ADMIN_STORAGE_STATE,
        },
        dependencies: ["setup-admin"],
      },
      {
        // Non-admin actor: runs ONLY the permissions spec with the member's
        // session, so the UI's team-scoped visibility filtering is verified.
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
      command:
        "bun --env-file=.env core/e2e/scripts/start-e2e-server.ts",
      cwd: "../../",
      // Wait for READINESS (plugins initialized), not just liveness - the app
      // isn't usable until then. Playwright owns the lifecycle (no reuse) so
      // there's no orphan-port race; the port must be free at start.
      url: "http://localhost:3100/.checkstack/ready",
      timeout: 180_000,
      reuseExistingServer: false,
    },
  },
});
