import path from "node:path";
import { fileURLToPath } from "node:url";

// Playwright evaluates configs/tests via Node (not Bun), so derive the dir from
// import.meta.url rather than Bun's `import.meta.dir`.
const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Shared authentication constants + paths for the authenticated E2E suite.
 *
 * The harness boots against a freshly reset, isolated database (see
 * `scripts/start-e2e-server.ts`), so every run starts with zero users and the
 * app shows the first-run onboarding flow. `auth.setup.ts` drives that flow to
 * create this admin and persists the resulting better-auth session to
 * `ADMIN_STORAGE_STATE`, which the main `chromium` project loads so specs run
 * already logged in.
 */

/** First-run admin created via the onboarding flow. */
export const ADMIN_USER = {
  name: "E2E Admin",
  email: "e2e-admin@checkstack.local",
  // Satisfies the onboarding passwordSchema: >= 8 chars, upper, lower, number.
  password: "E2eAdminPass123",
} as const;

/** Where the authenticated browser state (cookies) is persisted. */
export const ADMIN_STORAGE_STATE = path.join(
  here,
  "..",
  "..",
  "playwright",
  ".auth",
  "admin.json",
);
