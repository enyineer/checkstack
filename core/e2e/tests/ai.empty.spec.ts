import { test, expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Authenticated E2E coverage for the AI assistant SHELL (plan §3.2).
 *
 * OWNER DECISION: the send / tool-call / response loop stays INTEGRATION-only
 * (covered by `agent-runner.test.ts` with the mocked agent runner). CI wires no
 * real model, so this e2e exercises only the shell: the chat surface, its
 * no-integration empty state (and the resulting disabled composer), the new-chat
 * control, and the sibling skills / memories routes. It must never depend on a
 * model being configured.
 *
 * The harness boots an empty database, so NO AI integration exists — the chat
 * deterministically shows the "No AI integration configured" empty state.
 */
test.describe.configure({ mode: "serial" });

test.describe("AI assistant shell", () => {
  test("the chat route renders its shell with the no-integration empty state", async ({
    page,
  }) => {
    await page.goto("/ai/chat", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { name: "AI assistant", level: 2 }),
    ).toBeVisible({ timeout: 30_000 });

    // With no OpenAI-compatible connection, the composer surface guides the
    // operator to add one rather than failing.
    await expect(
      page.getByText("No AI integration configured"),
    ).toBeVisible();

    // Not the catch-all 404 / a load failure.
    await expect(
      page.getByRole("heading", { name: "Route not found" }),
    ).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(
      "This page failed to load",
    );
  });

  test("the message composer is disabled while no integration is configured", async ({
    page,
  }) => {
    await page.goto("/ai/chat", { waitUntil: "domcontentloaded" });

    const input = page.getByPlaceholder("Message the assistant...");
    await expect(input).toBeVisible({ timeout: 30_000 });
    // The composer is disabled until an integration exists (no model => no send).
    await expect(input).toBeDisabled();
  });

  test("the chat sidebar exposes a new-chat control", async ({ page }) => {
    await page.goto("/ai/chat", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: /New chat/i }),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("the skills route renders without crashing", async ({ page }) => {
    await page.goto("/ai/skills", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Route not found" }),
    ).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(
      "This page failed to load",
    );
  });

  test("the memories route renders without crashing", async ({ page }) => {
    await page.goto("/ai/memories", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Route not found" }),
    ).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(
      "This page failed to load",
    );
  });
});
