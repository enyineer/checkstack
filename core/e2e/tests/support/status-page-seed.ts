import type { APIRequestContext } from "@playwright/test";
import { expect } from "@checkstack/test-utils-frontend/playwright";

/**
 * Seed a PUBLISHED status page (with an explicit block layout) through the real
 * authenticated oRPC API, then publish it.
 *
 * Why the API and not the builder UI: the builder's "Add a block" control is a
 * radix Select whose popover the builder's live-preview re-render intermittently
 * leaves open under automation, which makes it unreliable to drive for the
 * lower-list widget types (incidents / maintenance / announcements). The bugs
 * these specs guard are in the PUBLIC RENDERING of a published page, not in the
 * builder - so we set up the fixture via the API (exactly the calls the builder
 * makes) and still assert the real rendering in the browser. The builder's
 * add-block UI itself is covered by `status-page.spec.ts` (a content widget).
 *
 * Uses the caller's `page.request` (or any APIRequestContext) so it inherits the
 * admin session cookies from the test's storage state; oRPC bodies are wrapped
 * in `{ json: ... }` and responses unwrapped from it.
 */

export interface SeedBlock {
  id: string;
  type: string;
  config: unknown;
}

async function orpc(
  request: APIRequestContext,
  proc: string,
  input: unknown,
): Promise<Record<string, unknown>> {
  const res = await request.post(`/api/statuspage/${proc}`, {
    data: { json: input },
  });
  expect(
    res.ok(),
    `${proc} failed: HTTP ${res.status()} ${await res.text().catch(() => "")}`,
  ).toBeTruthy();
  const body = (await res.json()) as { json?: Record<string, unknown> };
  return body.json ?? (body as Record<string, unknown>);
}

/** Create → set the draft layout → publish. Returns the page id. */
export async function seedPublishedStatusPage({
  request,
  title,
  slug,
  blocks,
}: {
  request: APIRequestContext;
  title: string;
  slug: string;
  blocks: SeedBlock[];
}): Promise<string> {
  const created = await orpc(request, "createStatusPage", { title, slug });
  const id = created.id as string;
  await orpc(request, "updateStatusPage", { id, draftLayout: blocks });
  await orpc(request, "publishStatusPage", { id });
  return id;
}
