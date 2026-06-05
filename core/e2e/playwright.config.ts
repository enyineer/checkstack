import { devices } from "@playwright/test";
import { createPlaywrightConfig } from "@checkstack/test-utils-frontend/playwright";
import { ADMIN_STORAGE_STATE } from "./tests/support/auth";

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
 * Authentication: the `setup` project (`auth.setup.ts`) drives the first-run
 * onboarding flow once, which creates an admin and signs in, then persists the
 * session to `ADMIN_STORAGE_STATE`. The main `chromium` project loads that
 * storage state (via `dependencies: ["setup"]`) so every spec runs already
 * logged in as an admin.
 *
 * Prerequisites the harness does NOT manage (build them first - `pretest:e2e`
 * wires these up):
 *  - Postgres up: `docker compose -f docker-compose-dev.yml up -d`
 *  - Frontend built: `bun run --filter @checkstack/frontend build`
 *  - Docs built:     `bun run --filter @checkstack/docs build`
 */
export default createPlaywrightConfig({
  baseURL: "http://localhost:3100",
  testDir: "./tests",
  overrides: {
    // Override the factory's single default project to add a setup project (for
    // login) + the main authed project. The factory's top-level `use`
    // (baseURL/trace/screenshot) is inherited by both; we only add per-project
    // device + storageState here.
    projects: [
      {
        name: "setup",
        testMatch: /.*\.setup\.ts$/,
        use: { ...devices["Desktop Chrome"] },
      },
      {
        name: "chromium",
        testIgnore: /.*\.setup\.ts$/,
        use: {
          ...devices["Desktop Chrome"],
          storageState: ADMIN_STORAGE_STATE,
        },
        dependencies: ["setup"],
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
