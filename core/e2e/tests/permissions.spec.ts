import { test, expect } from "@checkstack/test-utils-frontend/playwright";
import { MEMBER_USER } from "./support/auth";

/**
 * Authenticated E2E coverage for UI permission / team-scoping (plan §3.3).
 *
 * Runs as the `member` Playwright project — i.e. with the NON-admin member's
 * session (see `member.setup.ts` + `playwright.config.ts`). This is the UI
 * counterpart to the `rpc.test.ts` G11 guard: an admin-only surface must be
 * DENIED through the UI for a member who lacks the grant, and admin-only nav
 * must not even render for them. A categorically-unauthorized area shows the
 * Access Denied gate (it does not silently render an empty admin page).
 *
 * The harness resets to an empty DB per run; the member is a plain user with
 * only the default (non-admin) access rules, so the admin-only auth settings
 * are reliably forbidden.
 */
test.describe.configure({ mode: "serial" });

test.describe("UI permissions (non-admin member)", () => {
  test("the member is signed in as themselves, not the admin", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // The navbar user menu shows the member's own name (session is the member's).
    await expect(
      page.getByRole("button", { name: MEMBER_USER.name }),
    ).toBeVisible({ timeout: 30_000 });
    // Not bounced back to the auth gate.
    await expect(page).not.toHaveURL(/\/(login|auth\/onboarding|auth\/register)/);
  });

  test("an admin-only route renders the Access Denied gate", async ({
    page,
  }) => {
    // Auth Settings requires the admin-only `auth.strategies` (manage) rule,
    // which a plain member does not have.
    await page.goto("/auth/settings", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Access Denied")).toBeVisible({
      timeout: 30_000,
    });
    // The gate must NOT be the catch-all 404 — it's a deliberate authz block.
    await expect(
      page.getByRole("heading", { name: "Route not found" }),
    ).toHaveCount(0);
  });

  test("admin-only navigation is not rendered for the member", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // Nav is filtered by the user's access rules, so admin-only entries are
    // absent for a non-admin member.
    await expect(
      page.getByRole("link", { name: "Auth Settings" }),
    ).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Teams" })).toHaveCount(0);
  });
});
