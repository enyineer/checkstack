import type { Page } from "@playwright/test";
import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Authenticated E2E for the markdown authoring surface: the Write/Preview
 * editor, its formatting toolbar, `#` cross-entity mentions, and the derived
 * "Referenced items" list.
 *
 * Boot-once variant: the DB is shared and non-empty, so every entity this file
 * creates is namespaced with a unique-per-run suffix (`NS`) and no test asserts
 * on global table state. Tests run serially because they form one chain: seed a
 * system -> seed a maintenance (the mention TARGET) -> create an incident ->
 * author an update that mentions the maintenance.
 *
 * Selectors come from the real component source (`MarkdownEditor`,
 * `ReferencedItems`, `IncidentUpdateForm`, `MaintenanceEditor`, `SystemEditor`)
 * - the editor's tablist is labelled "Editor mode", its toolbar buttons carry
 * aria-labels, and the mention popover is a listbox labelled "Mention
 * suggestions".
 */
test.describe.configure({ mode: "serial" });

const NS = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
const SYSTEM_NAME = `Markdown E2E System-${NS}`;
const MAINTENANCE_TITLE = `Database upgrade-${NS}`;
const INCIDENT_TITLE = `Checkout degraded-${NS}`;

const NAV = 30_000;

/**
 * The seeded system's id, captured from the catalog browse link.
 *
 * The incident list renders titles as plain text, not links - the only UI path
 * into an incident's detail page is its SYSTEM's incident history, which is
 * keyed by system id. Same approach `maintenance.spec.ts` uses.
 */
let systemId = "";

test.describe("markdown editor", () => {
  test("seeds a system for the incident and maintenance to target", async ({
    page,
  }) => {
    await page.goto("/catalog/config", { timeout: NAV });
    await expect(
      page.getByRole("heading", { name: "Catalog Management" }),
    ).toBeVisible({ timeout: NAV });

    const addFirst = page.getByRole("button", { name: "Add your first system" });
    const addFirstVisible = await addFirst.isVisible().catch(() => false);
    await (addFirstVisible
      ? addFirst.click()
      : page.getByRole("button", { name: "Add System" }).click());

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Create System" }),
    ).toBeVisible();
    await dialog.getByLabel("Name").fill(SYSTEM_NAME);
    await dialog.getByRole("button", { name: "Create System" }).click();
    await expect(dialog).toBeHidden({ timeout: NAV });

    // Resolve the system's id from the browse view. Systems sit inside
    // collapsible group sections, so expand any collapsed one first.
    await page.goto("/catalog/", { waitUntil: "commit" });
    const groupHeaders = page.getByRole("button", { name: /\d+ systems?$/ });
    await expect(groupHeaders.first()).toBeVisible({ timeout: NAV });
    const headerCount = await groupHeaders.count();
    for (let i = 0; i < headerCount; i++) {
      const header = groupHeaders.nth(i);
      if ((await header.getAttribute("aria-expanded")) !== "true") {
        await header.click();
      }
    }

    const systemLink = page.getByRole("link").filter({ hasText: SYSTEM_NAME });
    await expect(systemLink.first()).toBeVisible({ timeout: NAV });
    const href = await systemLink.first().getAttribute("href");
    systemId = href?.split("/").pop() ?? "";
    expect(systemId).not.toBe("");
  });

  test("the description field offers a Preview tab that renders markdown", async ({
    page,
  }) => {
    await page.goto("/maintenance/config", { timeout: NAV });

    await page.getByRole("button", { name: "Create Maintenance" }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Create Maintenance" }),
    ).toBeVisible({ timeout: NAV });

    await dialog.getByLabel("Title").fill(MAINTENANCE_TITLE);
    // A maintenance requires a system, same as an incident.
    await dialog.getByText(SYSTEM_NAME, { exact: true }).click();

    // The description is a MarkdownEditor: a Write/Preview tablist plus a
    // toolbar, in place of the plain textarea it replaced.
    const editorTabs = dialog.getByRole("tablist", { name: "Editor mode" });
    await expect(editorTabs).toBeVisible();

    await dialog.getByLabel("Description").fill("Upgrading **Postgres** to 17.");

    // Preview renders through the SAME MarkdownBlock the saved content uses, so
    // the emphasis must actually render rather than showing the raw asterisks.
    const previewTab = editorTabs.getByRole("tab", { name: "preview" });
    await expect(async () => {
      await previewTab.click();
      // SHORT: inside a `toPass` loop, so it must fail fast enough to retry.
      await expect(previewTab).toHaveAttribute("aria-selected", "true", {
        timeout: 5000,
      });
    }).toPass({ timeout: NAV });
    const preview = dialog.getByRole("tabpanel");
    await expect(preview.getByText("Postgres", { exact: true })).toBeVisible();
    await expect(preview).not.toContainText("**Postgres**");

    // Back to Write and finish creating - this maintenance is the mention
    // TARGET for the later tests.
    await editorTabs.getByRole("tab", { name: "write" }).click();
    await expect(dialog.getByLabel("Description")).toBeVisible();


    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: NAV });
  });

  test("an empty editor says there is nothing to preview", async ({ page }) => {
    await page.goto("/incident/config", { timeout: NAV });
    await page
      .getByRole("button", { name: "Report Incident", exact: true })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Create Incident" }),
    ).toBeVisible({ timeout: NAV });

    // Retry the switch: clicking a tab while the dialog is still running its
    // open animation can land before the handler is live, so a single click is
    // flaky here (it passed one run and failed the next). Retrying proves the
    // behaviour without pinning the test to animation timing.
    const previewTab = dialog
      .getByRole("tablist", { name: "Editor mode" })
      .getByRole("tab", { name: "preview" });
    await expect(async () => {
      await previewTab.click();
      // SHORT: inside a `toPass` loop, so it must fail fast enough to retry.
      await expect(previewTab).toHaveAttribute("aria-selected", "true", {
        timeout: 5000,
      });
    }).toPass({ timeout: NAV });

    await expect(dialog.getByText("Nothing to preview.")).toBeVisible();

    await dialog.getByRole("button", { name: "Cancel" }).click();
    const discard = page.getByRole("dialog", { name: "Discard changes?" });
    if (await discard.isVisible().catch(() => false)) {
      await discard.getByRole("button", { name: "Discard" }).click();
    }
    await expect(
      page.getByRole("dialog", { name: "Create Incident" }),
    ).toBeHidden();
  });

  test("creates an incident to author updates against", async ({ page }) => {
    await page.goto("/incident/config", { timeout: NAV });
    await page
      .getByRole("button", { name: "Report Incident", exact: true })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Create Incident" }),
    ).toBeVisible({ timeout: NAV });

    await dialog.getByLabel("Title").fill(INCIDENT_TITLE);
    // The affected-systems picker is a selectable row, not a button - same
    // selector the maintenance spec uses.
    await dialog.getByText(SYSTEM_NAME, { exact: true }).click();
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: NAV });

    await expect(page.getByText(INCIDENT_TITLE).first()).toBeVisible({
      timeout: NAV,
    });
  });

  test("the toolbar wraps a selection in bold", async ({ page }) => {
    await openIncidentDetail(page);

    const message = await openUpdateForm(page);
    await message.fill("emphasise me");
    // Select everything, then apply Bold - the transform wraps the SELECTION,
    // it does not append a placeholder.
    await message.press("ControlOrMeta+a");
    await page.getByRole("button", { name: "Bold", exact: true }).click();

    await expect(message).toHaveValue("**emphasise me**");
  });

  test("typing # offers mentions and inserts one as a markdown link", async ({
    page,
  }) => {
    await openIncidentDetail(page);

    const message = await openUpdateForm(page);
    await message.fill("Caused by ");
    // The picker triggers on a `#` that starts a word.
    await message.press("#");
    await message.pressSequentially("Database");

    const suggestions = page.getByRole("listbox", {
      name: "Mention suggestions",
    });
    await expect(suggestions).toBeVisible({ timeout: NAV });
    await expect(
      suggestions.getByRole("option", { name: new RegExp(MAINTENANCE_TITLE) }),
    ).toBeVisible();

    await suggestions
      .getByRole("option", { name: new RegExp(MAINTENANCE_TITLE) })
      .click();

    // A mention is stored as an ordinary markdown link whose href names WHAT it
    // points at, never a URL - so it can resolve differently per context.
    await expect(message).toHaveValue(
      new RegExp(
        String.raw`Caused by \[` +
          escapeRegex(MAINTENANCE_TITLE) +
          String.raw`\]\(checkstack:maintenance/[\w-]+\) $`,
      ),
    );
  });

  test("the mention picker can be navigated and chosen with the KEYBOARD", async ({
    page,
  }) => {
    // REGRESSION GUARD. Trigger detection re-runs on every keyup, including the
    // arrow keys the open picker already consumed on keydown. It used to reset
    // the highlighted option each time, so arrow keys did nothing and Enter
    // always inserted the FIRST suggestion. Clicking an option with the mouse
    // (as the other tests do) never exercises that path.
    await openIncidentDetail(page);

    const message = await openUpdateForm(page);
    await message.fill("See ");
    await message.press("#");

    const suggestions = page.getByRole("listbox", {
      name: "Mention suggestions",
    });
    await expect(suggestions).toBeVisible({ timeout: NAV });

    const options = suggestions.getByRole("option");
    const optionCount = await options.count();
    // Only meaningful with something to move to.
    test.skip(optionCount < 2, "needs at least two mentionable records");

    // Read the option TITLES from their label span. `textContent()` on the
    // option would concatenate the title and the description with no separator,
    // and only the title is inserted into the document.
    const titleOf = async (index: number) =>
      (
        (await options.nth(index).locator("span").first().textContent()) ?? ""
      ).trim();
    const firstTitle = await titleOf(0);
    const secondTitle = await titleOf(1);
    expect(secondTitle).not.toBe(firstTitle);

    await message.press("ArrowDown");
    // The highlight must MOVE and stay moved after the KEYUP - the keyup is
    // where the regression lived.
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(options.nth(0)).toHaveAttribute("aria-selected", "false");

    await message.press("Enter");
    // Enter inserts the option the user actually navigated to, not the first.
    await expect(message).toHaveValue(new RegExp(escapeRegex(secondTitle)));
    await expect(message).not.toHaveValue(new RegExp(escapeRegex(firstTitle)));
  });

  test("a posted mention renders as a link and appears in Referenced items", async ({
    page,
  }) => {
    await openIncidentDetail(page);

    const message = await openUpdateForm(page);
    await message.fill("Related to ");
    await message.press("#");
    await message.pressSequentially("Database");

    const suggestions = page.getByRole("listbox", {
      name: "Mention suggestions",
    });
    await expect(suggestions).toBeVisible({ timeout: NAV });
    await suggestions
      .getByRole("option", { name: new RegExp(MAINTENANCE_TITLE) })
      .click();

    await page.getByRole("button", { name: "Post Update" }).click();
    // The form closes only in the mutation's onSuccess. Asserted on the message
    // FIELD, never the submit button, which relabels to "Posting..." the moment
    // submit starts and would make this pass before the post landed.
    await expect(page.getByLabel("Update Message")).toBeHidden({
      timeout: NAV,
    });

    // TWO links now carry the maintenance title: the INLINE mention inside the
    // update, and the "Referenced items" chip below it.
    //
    // The count is the point. This used to assert
    // `getByRole("link", { name: MAINTENANCE_TITLE }).first()`, which matched
    // the CHIP - a plain router Link that renders whether or not the inline
    // mention works. So the test passed while every inline mention rendered as
    // dead text (react-markdown blanks any href outside its safe-protocol list
    // before the renderer sees it). Asserting the count is what distinguishes
    // "the mention resolved" from "the chip exists".
    const mentionLinks = page.getByRole("link", { name: MAINTENANCE_TITLE });
    await expect(mentionLinks).toHaveCount(2, { timeout: NAV });
    for (const link of await mentionLinks.all()) {
      await expect(link).toHaveAttribute("href", /\/maintenance\/[\w-]+/);
    }

    // "Referenced items" is DERIVED from the authored text on render - nothing
    // is stored twice - so the freshly posted update populates it immediately.
    await expect(page.getByText("Referenced items")).toBeVisible({
      timeout: NAV,
    });
  });

  /**
   * The MAINTENANCE detail page is the third authoring surface (admin incident
   * detail, admin maintenance detail, public status page) and had no mention
   * coverage at all. It renders through the same `StatusUpdateTimeline` +
   * `Markdown` path, but nothing proved that - and the react-markdown
   * `urlTransform` defect broke every one of them identically while the
   * incident test still passed on the "Referenced items" chip.
   */
  test("a mention posted on the MAINTENANCE detail page also resolves", async ({
    page,
  }) => {
    await page.goto(`/maintenance/system/${systemId}/history`, {
      waitUntil: "commit",
    });
    await page
      .getByRole("row", { name: new RegExp(escapeRegex(MAINTENANCE_TITLE)) })
      .click();
    await expect(
      page.getByRole("heading", { name: MAINTENANCE_TITLE }),
    ).toBeVisible({ timeout: NAV });

    const message = await openUpdateForm(page);
    await message.fill("Caused by ");
    await message.press("#");
    // Human-paced: the picker's trigger state is synced from key events, so
    // machine-speed input can leave it behind and insert over a stale range.
    await message.pressSequentially("Checkout", { delay: 25 });

    const suggestions = page.getByRole("listbox", {
      name: "Mention suggestions",
    });
    await expect(suggestions).toBeVisible({ timeout: NAV });
    await suggestions
      .getByRole("option", { name: new RegExp(escapeRegex(INCIDENT_TITLE)) })
      .click();
    await expect(message).toHaveValue(/\(checkstack:incident\/[\w-]+\)/);

    await page.getByRole("button", { name: "Post Update" }).click();
    await expect(page.getByLabel("Update Message")).toBeHidden({
      timeout: NAV,
    });

    // Inline mention + "Referenced items" chip, both pointing at the incident.
    const mentionLinks = page.getByRole("link", { name: INCIDENT_TITLE });
    await expect(mentionLinks).toHaveCount(2, { timeout: NAV });
    for (const link of await mentionLinks.all()) {
      await expect(link).toHaveAttribute("href", /\/incident\/[\w-]+/);
    }
  });
});

/** Escapes a string for safe embedding in a RegExp. */
function escapeRegex(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/**
 * Opens the namespaced incident's detail page via its system's incident
 * history - the only UI path in (the incident list renders titles as text).
 */
async function openIncidentDetail(page: Page): Promise<void> {
  expect(systemId).not.toBe("");
  await page.goto(`/incident/system/${systemId}/incidents`, {
    waitUntil: "commit",
  });
  await expect(
    page.getByRole("heading", { name: /Incident History/ }),
  ).toBeVisible({ timeout: NAV });

  const row = page.getByRole("row", { name: new RegExp(INCIDENT_TITLE) });
  await expect(row).toBeVisible({ timeout: NAV });
  await row.click();

  await expect(page).toHaveURL(/\/incident\/[^/]+(\?|$)/, { timeout: NAV });
  await expect(
    page.getByRole("heading", { name: INCIDENT_TITLE }),
  ).toBeVisible({ timeout: NAV });
}

/** Opens the "add update" form and returns its message textarea. */
async function openUpdateForm(page: Page) {
  const addUpdate = page.getByRole("button", { name: /Add Update/i }).first();
  if (await addUpdate.isVisible().catch(() => false)) {
    await addUpdate.click();
  }
  const message = page.getByLabel("Update Message");
  await expect(message).toBeVisible({ timeout: NAV });
  return message;
}
