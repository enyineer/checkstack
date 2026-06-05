import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Satellites read UI. On a fresh, empty database no satellites exist
 * (registration is backend/agent-driven), so the list page must render its
 * page chrome plus the onboarding empty state and a working "create" affordance.
 *
 * The file shares ONE fresh DB, so run serially and keep read-only / empty-state
 * assertions ahead of any UI that mutates state.
 */
test.describe.configure({ mode: "serial" });

test.describe("satellites", () => {
  test("renders the page chrome with title, subtitle and create action", async ({
    page,
  }) => {
    await page.goto("/satellite/", { waitUntil: "load", timeout: 30_000 });

    // PageLayout renders the title as an <h2> heading.
    await expect(
      page.getByRole("heading", { name: "Satellites" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Manage distributed satellite nodes for remote health check execution",
      ),
    ).toBeVisible();

    // The "Satellite Nodes" card is always present.
    await expect(
      page.getByText("Satellite Nodes", { exact: true }),
    ).toBeVisible();

    // The header action button to register a satellite.
    await expect(
      page.getByRole("button", { name: "Create Satellite", exact: true }),
    ).toBeVisible();

    // We must NOT be on the catch-all 404.
    await expect(page.locator("body")).not.toContainText("Route not found");
  });

  test("shows the onboarding empty state when no satellites are registered", async ({
    page,
  }) => {
    await page.goto("/satellite/", { waitUntil: "load", timeout: 30_000 });

    await expect(page.getByText("No satellites yet")).toBeVisible();
    await expect(
      page.getByText(
        /A satellite is a small Checkstack agent you run somewhere else/,
      ),
    ).toBeVisible();

    // The numbered onboarding steps render as a list.
    await expect(
      page.getByText(
        "Create a satellite here to mint a registration token.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        /Deploy the satellite container or binary on the target machine/,
      ),
    ).toBeVisible();
    await expect(
      page.getByText(/Once it's online, assign health checks to it/),
    ).toBeVisible();

    // The empty state offers its own "Create satellite" CTA (distinct casing
    // from the header button) since the admin has manage access.
    await expect(
      page.getByRole("button", { name: "Create satellite", exact: true }),
    ).toBeVisible();
  });

  test("the create affordance opens the registration dialog", async ({
    page,
  }) => {
    await page.goto("/satellite/", { waitUntil: "load", timeout: 30_000 });

    await page
      .getByRole("button", { name: "Create Satellite", exact: true })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "Create Satellite" }),
    ).toBeVisible();
    await expect(
      dialog.getByText(
        "Deploy a satellite node to run health checks from a remote location.",
      ),
    ).toBeVisible();

    // The registration form fields are present.
    await expect(dialog.getByLabel("Name")).toBeVisible();
    await expect(dialog.getByLabel("Region")).toBeVisible();
    await expect(
      dialog.getByPlaceholder("EU West Production"),
    ).toBeVisible();
    await expect(dialog.getByPlaceholder("eu-west-1")).toBeVisible();

    // Closing the dialog returns to the empty state without creating anything.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("No satellites yet")).toBeVisible();
  });
});
