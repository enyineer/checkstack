import { test, expect, type Page } from "@checkstack/test-utils-frontend/playwright";
import { seedPublishedStatusPage } from "./support/status-page-seed";

/**
 * Public status-page rendering of incident / maintenance event feeds, reported by
 * @stuajnht. Drives the REAL lean public bundle via `/statuspage/view/:slug` and
 * the per-item detail pages, asserting the RENDERED DOM - the layer the logic
 * tests cannot reach:
 *
 *  - #3 update status changes render COLOURED (a status-tone class, not the muted
 *    grey) and on their OWN line, on the block AND the detail page.
 *  - #4 update messages + descriptions render sanitized MARKDOWN (a real link),
 *    not the raw `[text](url)` source.
 *  - #5 the summary BLOCK caps the timeline (maxUpdates), while the DETAIL page
 *    shows ALL public updates.
 *  - #6 the individual incident AND maintenance pages render the description.
 *
 * Boot-once, data-isolated: every entity is namespaced (`NS`); assertions are
 * scoped to OUR namespaced page/slug, never global/whole-DB state. Serial within
 * the file (a create -> build -> assert chain); parallel ACROSS spec files.
 */
test.describe.configure({ mode: "serial" });

const NS = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
const SYSTEM_NAME = `Event Render Sys-${NS}`;
const INCIDENT_TITLE = `Checkout outage-${NS}`;
// Markdown in the description proves the detail page renders it (not raw source).
const INCIDENT_DESC_LINK = `runbook-${NS}`;
const INCIDENT_DESCRIPTION = `Impact summary; see [${INCIDENT_DESC_LINK}](https://example.com/runbook).`;
const UPDATE_ONE = `Root cause identified-${NS}`;
const UPDATE_TWO_LINK = `dashboard-${NS}`;
const UPDATE_TWO = `Monitoring recovery, see [${UPDATE_TWO_LINK}](https://example.com/dash).`;
const WINDOW_TITLE = `DB upgrade-${NS}`;
const WINDOW_DESC_LINK = `plan-${NS}`;
const WINDOW_DESCRIPTION = `Rolling restart; see [${WINDOW_DESC_LINK}](https://example.com/plan).`;
const WINDOW_UPDATE = `Maintenance in progress-${NS}`;
const PAGE_TITLE = `Event Render Status-${NS}`;
const PAGE_SLUG = `eventrender-${NS}`;

const NAV_TIMEOUT = 30_000;
/** Resolved from the catalog browse row; shared across tests in this file. */
let systemId = "";

async function fillDateTime({
  page,
  label,
  date,
}: {
  page: Page;
  label: string;
  date: Date;
}): Promise<void> {
  const group = page.getByRole("group", { name: label });
  const pad = (v: number): string => String(v).padStart(2, "0");
  await group.getByPlaceholder("DD").fill(pad(date.getDate()));
  await group.getByPlaceholder("MM").first().fill(pad(date.getMonth() + 1));
  await group.getByPlaceholder("YYYY").fill(String(date.getFullYear()));
  await group.getByPlaceholder("HH").fill(pad(date.getHours()));
  await group.getByPlaceholder("MM").last().fill(pad(date.getMinutes()));
}

/** Post a PUBLIC update (default visibility) on the currently-open detail page. */
async function postUpdate({
  page,
  message,
  statusChange,
}: {
  page: Page;
  message: string;
  statusChange?: string;
}): Promise<void> {
  await page.getByRole("button", { name: "Add Update" }).click();
  await page.getByLabel("Update Message").fill(message);
  if (statusChange) {
    // The status-change Select defaults its VALUE to "__keep_current__", so its
    // trigger shows the selected item text "Keep Current (<status>)" - NOT the
    // placeholder. It has no accessible name, so target it by that "Keep Current"
    // text (unique vs the sibling visibility combobox, which shows "Public").
    await page
      .getByRole("combobox")
      .filter({ hasText: "Keep Current" })
      .click();
    await page.getByRole("option", { name: statusChange, exact: true }).click();
  }
  // Visibility already defaults to "Public" - the only kind the public page shows.
  await page.getByRole("button", { name: "Post Update" }).click();
  await expect(page.getByText("Update posted")).toBeVisible({
    timeout: NAV_TIMEOUT,
  });
}

test.describe("status page - event feed rendering (#3/#4/#5/#6)", () => {
  test("create the prerequisite system + resolve its id", async ({ page }) => {
    await page.goto("/catalog/config", { waitUntil: "commit" });
    await expect(
      page.getByRole("heading", { name: "Catalog Management" }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });
    await page.getByRole("button", { name: "Add System" }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Create System" }),
    ).toBeVisible();
    await dialog.getByLabel("Name").fill(SYSTEM_NAME);
    await dialog.getByRole("button", { name: "Create System" }).click();
    await expect(dialog).toBeHidden();

    await page.goto("/catalog/", { waitUntil: "commit" });
    const groupHeaders = page.getByRole("button", { name: /\d+ systems?$/ });
    await expect(groupHeaders.first()).toBeVisible({ timeout: NAV_TIMEOUT });
    const headerCount = await groupHeaders.count();
    for (let i = 0; i < headerCount; i++) {
      const header = groupHeaders.nth(i);
      if ((await header.getAttribute("aria-expanded")) !== "true") {
        await header.click();
      }
    }
    const systemLink = page.getByRole("link").filter({ hasText: SYSTEM_NAME });
    await expect(systemLink).toBeVisible({ timeout: NAV_TIMEOUT });
    const href = await systemLink.getAttribute("href");
    systemId = href?.match(/\/catalog\/system\/([^/?#]+)/)?.[1] ?? "";
    expect(systemId).not.toBe("");
  });

  test("create an incident (markdown description) and post two public updates", async ({
    page,
  }) => {
    await page.goto("/incident/config", { waitUntil: "commit" });
    await page
      .getByRole("button", { name: "Report Incident", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Create Incident" }),
    ).toBeVisible();
    await dialog.getByLabel("Title").fill(INCIDENT_TITLE);
    await dialog.getByLabel("Description").fill(INCIDENT_DESCRIPTION);
    await dialog.getByText(SYSTEM_NAME, { exact: true }).click();
    await expect(dialog.getByText("1 system(s) selected")).toBeVisible();
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(dialog).toBeHidden();

    // Open the incident detail via its system history, then post two updates.
    await page.goto(`/incident/system/${systemId}/incidents`, {
      waitUntil: "commit",
    });
    await page.getByRole("row", { name: new RegExp(INCIDENT_TITLE) }).click();
    await expect(
      page.getByRole("heading", { name: INCIDENT_TITLE }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });

    await postUpdate({ page, message: UPDATE_ONE, statusChange: "Identified" });
    await postUpdate({ page, message: UPDATE_TWO, statusChange: "Monitoring" });
  });

  test("create a maintenance window (markdown description) and post a public update", async ({
    page,
  }) => {
    await page.goto("/maintenance/config", { waitUntil: "commit" });
    await page.getByRole("button", { name: "Create Maintenance" }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Create Maintenance" }),
    ).toBeVisible();
    await dialog.getByLabel("Title").fill(WINDOW_TITLE);
    await dialog.getByLabel("Description").fill(WINDOW_DESCRIPTION);
    await dialog.getByText(SYSTEM_NAME, { exact: true }).click();
    await expect(dialog.getByText("1 system(s) selected")).toBeVisible();
    await fillDateTime({
      page,
      label: "Start Date & Time",
      date: new Date(Date.now() + 60 * 60 * 1000),
    });
    await fillDateTime({
      page,
      label: "End Date & Time",
      date: new Date(Date.now() + 2 * 60 * 60 * 1000),
    });
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("Maintenance created")).toBeVisible();

    await page.goto(`/maintenance/system/${systemId}/history`, {
      waitUntil: "commit",
    });
    await page.getByRole("row", { name: new RegExp(WINDOW_TITLE) }).click();
    await expect(
      page.getByRole("heading", { name: WINDOW_TITLE }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });
    await postUpdate({ page, message: WINDOW_UPDATE });
  });

  test("publish a page with incidents (maxUpdates=1) + maintenance widgets bound to the system", async ({
    page,
  }) => {
    expect(systemId).not.toBe("");
    // Seed the published layout through the real API (see status-page-seed.ts).
    // Incidents block caps updates to 1 so #5 (detail shows ALL) is observable;
    // both event-feed widgets are bound to our seeded system.
    await seedPublishedStatusPage({
      request: page.request,
      title: PAGE_TITLE,
      slug: PAGE_SLUG,
      blocks: [
        {
          id: "inc-block",
          type: "statuspage.incidents",
          config: { systemIds: [systemId], showUpdates: true, maxUpdates: 1 },
        },
        {
          id: "mnt-block",
          type: "statuspage.maintenance",
          config: { systemIds: [systemId], showUpdates: true },
        },
      ],
    });
  });

  test("the summary block caps updates and colours the status change (#3/#5)", async ({
    page,
  }) => {
    await page.goto(`/statuspage/view/${PAGE_SLUG}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: INCIDENT_TITLE }),
    ).toBeVisible({ timeout: NAV_TIMEOUT });

    // #5 (block cap = 1): the newest update shows, the older one does NOT.
    await expect(page.getByText(UPDATE_TWO_LINK)).toBeVisible();
    await expect(page.getByText(UPDATE_ONE)).toHaveCount(0);

    // #3: the status-change label is on its own line AND coloured by a status
    // tone (a `text-status-*` class), never the muted `text-muted-foreground`.
    const statusLabel = page
      .locator("span.uppercase")
      .filter({ hasText: "Monitoring" })
      .first();
    await expect(statusLabel).toBeVisible();
    await expect(statusLabel).toHaveClass(/text-status-/);
    await expect(statusLabel).not.toHaveClass(/text-muted-foreground/);

    // #4 (block): the update message markdown renders a real link.
    const dashLink = page.getByRole("link", { name: UPDATE_TWO_LINK });
    await expect(dashLink).toHaveAttribute("href", "https://example.com/dash");
  });

  test("the incident detail page shows ALL updates + description in markdown (#4/#5/#6)", async ({
    page,
  }) => {
    await page.goto(`/statuspage/view/${PAGE_SLUG}`, {
      waitUntil: "domcontentloaded",
    });
    // Click the incident title link to open its public detail page.
    await page.getByRole("link", { name: INCIDENT_TITLE }).click();
    await expect(page).toHaveURL(
      new RegExp(`/statuspage/view/${PAGE_SLUG}/incident/`),
      { timeout: NAV_TIMEOUT },
    );

    // #5: BOTH updates are shown (the block cap does not apply to the detail).
    await expect(page.getByText(UPDATE_ONE)).toBeVisible();
    await expect(page.getByText(UPDATE_TWO_LINK)).toBeVisible();

    // #6 + #4: the description renders as markdown (a real link, not raw source).
    const runbook = page.getByRole("link", { name: INCIDENT_DESC_LINK });
    await expect(runbook).toBeVisible();
    await expect(runbook).toHaveAttribute(
      "href",
      "https://example.com/runbook",
    );
    await expect(page.getByText(`[${INCIDENT_DESC_LINK}]`)).toHaveCount(0);

    // #3: the lifecycle status pill next to the title is coloured (not neutral).
    await expect(
      page.locator("span.uppercase").filter({ hasText: "Identified" }).first(),
    ).toHaveClass(/text-status-/);
  });

  test("the maintenance detail page renders the description in markdown (#6)", async ({
    page,
  }) => {
    await page.goto(`/statuspage/view/${PAGE_SLUG}`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("link", { name: WINDOW_TITLE }).click();
    await expect(page).toHaveURL(
      new RegExp(`/statuspage/view/${PAGE_SLUG}/maintenance/`),
      { timeout: NAV_TIMEOUT },
    );

    // #6: the maintenance description renders (previously absent), as markdown.
    const planLink = page.getByRole("link", { name: WINDOW_DESC_LINK });
    await expect(planLink).toBeVisible();
    await expect(planLink).toHaveAttribute("href", "https://example.com/plan");
    // #5: its public update is shown on the detail page.
    await expect(page.getByText(WINDOW_UPDATE)).toBeVisible();
  });
});
