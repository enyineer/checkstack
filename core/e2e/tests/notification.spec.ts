import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Notifications & subscriptions area. The DB is freshly reset and empty for
 * this file (only the admin user exists), so the inbox starts with no
 * notifications and there are no active subscriptions. These specs assert the
 * page render + empty-state UI for the inbox (`/notification/`) and the
 * settings/subscription manager (`/notification/settings`), plus the navbar
 * notification bell. Meaningful notification events are out of scope.
 *
 * Serial mode: the whole file shares one backend/DB, so empty-state
 * assertions are kept independent of any mutating action.
 */
test.describe.configure({ mode: "serial" });

test.describe("notifications & subscriptions", () => {
  test("inbox renders with the empty state when there are no notifications", async ({
    page,
  }) => {
    await page.goto("/notification/", { waitUntil: "load" });

    // The PageLayout title heading proves the inbox page mounted (not the
    // catch-all 404).
    await expect(
      page.getByRole("heading", { name: "Notifications" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("body")).not.toContainText("Route not found");

    // Empty DB -> zero notifications counter.
    await expect(page.getByText("0 notifications")).toBeVisible();

    // ListEmptyState messaging for an all-caught-up inbox.
    await expect(
      page.getByText(
        "You're all caught up. New notifications about systems you're subscribed to will show up here.",
      ),
    ).toBeVisible();
  });

  test("inbox exposes the filter and mark-all-read affordances", async ({
    page,
  }) => {
    await page.goto("/notification/", { waitUntil: "load" });
    await expect(
      page.getByRole("heading", { name: "Notifications" }),
    ).toBeVisible({ timeout: 15_000 });

    // "Mark all read" header action is always present (the bulk mark-as-read
    // affordance).
    await expect(
      page.getByRole("button", { name: "Mark all read" }),
    ).toBeVisible();

    // The filter dropdown defaults to "All" and exposes the unread filter.
    // `exact` avoids matching "Mark all read" by accessible-name substring.
    const filterTrigger = page.getByRole("button", { name: "All", exact: true });
    await expect(filterTrigger).toBeVisible();
    await filterTrigger.click();

    await expect(
      page.getByRole("menuitem", { name: "All notifications" }),
    ).toBeVisible();
    const unreadOnly = page.getByRole("menuitem", { name: "Unread only" });
    await expect(unreadOnly).toBeVisible();

    // Switching to the unread filter keeps the empty state (still no
    // notifications).
    await unreadOnly.click();
    await expect(page.getByRole("button", { name: "Unread" })).toBeVisible();
    await expect(
      page.getByText(
        "You're all caught up. New notifications about systems you're subscribed to will show up here.",
      ),
    ).toBeVisible();
  });

  test("settings page renders the subscription manager and channel sections", async ({
    page,
  }) => {
    await page.goto("/notification/settings", { waitUntil: "load" });

    await expect(
      page.getByRole("heading", { name: "Notification Settings" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("body")).not.toContainText("Route not found");

    // Channels section header (how the user is reached).
    await expect(
      page.getByRole("heading", { name: "Your Notification Channels" }),
    ).toBeVisible();

    // Subscriptions section header (what the user is reached about).
    await expect(
      page.getByRole("heading", { name: "Your Subscriptions" }),
    ).toBeVisible();

    // Empty DB -> no active subscriptions yet.
    await expect(page.getByText("No active subscriptions")).toBeVisible();
  });

  test("settings page shows admin delivery + retention sections for the admin", async ({
    page,
  }) => {
    await page.goto("/notification/settings", { waitUntil: "load" });
    await expect(
      page.getByRole("heading", { name: "Notification Settings" }),
    ).toBeVisible({ timeout: 15_000 });

    // The admin-only divider and delivery-channel admin section render for an
    // admin session.
    await expect(page.getByText("Admin Settings")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Delivery Channels" }),
    ).toBeVisible();

    // The bundled delivery strategies (Slack, Discord, SMTP, ...) are
    // registered in this install, so each renders an admin strategy card with
    // a per-channel enable/disable toggle defaulting to "Disabled".
    await expect(
      page.getByText("Send notifications via Slack incoming webhooks"),
    ).toBeVisible();
    await expect(
      page.getByText("Send notifications via Discord webhooks"),
    ).toBeVisible();
    await expect(page.getByText("Disabled").first()).toBeVisible();

    // The delivery-attempts inspector link is present for admins.
    await expect(
      page.getByRole("heading", { name: "Delivery Attempts" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open inspector" }),
    ).toBeVisible();

    // The retention policy admin section renders below the inspector.
    await expect(
      page.getByRole("heading", { name: "Retention Policy" }),
    ).toBeVisible();
  });

  test("the navbar notification bell is present and links to the inbox", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "load" });

    // App shell mounted.
    await expect(
      page.getByRole("heading", { name: "Checkstack" }),
    ).toBeVisible({ timeout: 15_000 });

    // The bell renders in the navbar-right slot as an icon-only Popover
    // trigger. With an empty inbox it carries no unread badge, so locate it by
    // its lucide Bell icon and open the popover to assert its contents.
    const bell = page.locator("button:has(svg.lucide-bell)").first();
    await expect(bell).toBeVisible();

    // Opening the bell shows the "Notifications" popover header and, with an
    // empty inbox, the no-unread empty state.
    await bell.click();
    await expect(
      page.getByText("Notifications", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("No unread notifications"),
    ).toBeVisible();

    // The footer link routes to the full inbox.
    const viewAll = page.getByRole("link", {
      name: "View all notifications",
    });
    await expect(viewAll).toBeVisible();
    await expect(viewAll).toHaveAttribute("href", "/notification/");
  });
});
