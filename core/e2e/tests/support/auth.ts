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
 * app shows the first-run onboarding flow.
 *
 * Two setup projects seed two actors (see `playwright.config.ts`):
 *  - `setup-admin` (`auth.setup.ts`) drives onboarding to create the first
 *    ADMIN and persists its session to `ADMIN_STORAGE_STATE`. Most specs run as
 *    this actor.
 *  - `setup-member` (`member.setup.ts`) self-registers a second, NON-admin
 *    MEMBER through the public `/auth/register` flow and persists its session to
 *    `MEMBER_STORAGE_STATE`. The permissions spec runs as this actor to prove
 *    team-scoped visibility filtering through the UI (the UI counterpart to the
 *    `rpc.test.ts` G11 guard).
 */

/** First-run admin created via the onboarding flow. */
export const ADMIN_USER = {
  name: "E2E Admin",
  email: "e2e-admin@checkstack.local",
  // Satisfies the onboarding passwordSchema: >= 8 chars, upper, lower, number.
  password: "E2eAdminPass123",
} as const;

/**
 * Second, NON-admin actor, self-registered after the admin exists. A user
 * created via `/auth/register` (not onboarding) is a plain member with no
 * admin grants, which is exactly what the permissions spec needs.
 */
export const MEMBER_USER = {
  name: "E2E Member",
  email: "e2e-member@checkstack.local",
  // Satisfies passwordSchema: >= 8 chars, upper, lower, number.
  password: "E2eMemberPass123",
} as const;

/** Where the authenticated ADMIN browser state (cookies) is persisted. */
export const ADMIN_STORAGE_STATE = path.join(
  here,
  "..",
  "..",
  "playwright",
  ".auth",
  "admin.json",
);

/** Where the authenticated MEMBER browser state (cookies) is persisted. */
export const MEMBER_STORAGE_STATE = path.join(
  here,
  "..",
  "..",
  "playwright",
  ".auth",
  "member.json",
);
