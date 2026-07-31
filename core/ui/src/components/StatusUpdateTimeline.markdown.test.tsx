import "@checkstack/test-utils-frontend/setup";
import { describe, expect, it } from "bun:test";
import { render, within } from "@testing-library/react";
import { StatusUpdateTimeline } from "./StatusUpdateTimeline";

/**
 * Update bodies are operator-authored markdown and must render as BLOCK
 * markdown.
 *
 * The timeline used the INLINE `<Markdown>`, which maps every paragraph to a
 * `<span>` and registers no heading, list, blockquote, or table renderers at
 * all. So an author who wrote a heading and a bulleted list saw exactly that in
 * the editor's own preview (which uses `MarkdownBlock`) and then got one
 * undifferentiated run of text on the incident / maintenance detail page.
 */

const AT = "2026-07-01T01:00:00Z";

/** Scoped queries: RTL's destructured ones bind to `document.body`, so repeated
 * text across tests in one file collides when cleanup does not run between. */
function renderTimeline(message: string) {
  const result = render(
    <StatusUpdateTimeline updates={[{ id: "u1", message, createdAt: AT }]} />
  );
  return { ...result, q: within(result.container) };
}

describe("StatusUpdateTimeline renders update bodies as block markdown", () => {
  it("renders a paragraph as a block <p>, not an inline <span>", () => {
    const { q } = renderTimeline("We found the cause.");

    expect(q.getByText("We found the cause.").tagName).toBe("P");
  });

  it("keeps separate paragraphs separate", () => {
    // The reported symptom: two authored lines ran together on one line.
    const { q } = renderTimeline("Test!!!\n\n:(");

    expect(q.getByText("Test!!!").tagName).toBe("P");
    expect(q.getByText(":(").tagName).toBe("P");
  });

  it("renders markdown headings and lists as real elements", () => {
    const { q, container } = renderTimeline(
      "## Impact\n\n- Checkout is down\n- Search is slow"
    );

    expect(q.getByRole("heading", { name: "Impact" }).tagName).toBe("H2");
    const bullets = container.querySelector("ul");
    expect(
      Array.from(bullets?.children ?? []).map((li) => li.textContent)
    ).toEqual(["Checkout is down", "Search is slow"]);
  });

  it("renders emphasis rather than leaking the markdown source", () => {
    const { q } = renderTimeline("A **hard** outage");

    expect(q.getByText("hard").tagName).toBe("STRONG");
    expect(q.queryByText(/\*\*/)).toBeNull();
  });
});

describe("StatusUpdateTimeline mentions", () => {
  const MENTION = "Caused by [Database upgrade](checkstack:maintenance/abc-123)";

  it("links a resolved mention inside a block-rendered body", () => {
    const result = render(
      <StatusUpdateTimeline
        updates={[{ id: "u1", message: MENTION, createdAt: AT }]}
        resolveMention={() => "/maintenance/abc-123"}
      />
    );

    expect(
      within(result.container)
        .getByRole("link", { name: "Database upgrade" })
        .getAttribute("href")
    ).toBe("/maintenance/abc-123");
  });

  it("renders a mention as plain text with no resolver", () => {
    // A reference the viewer may not read must not become a link.
    const { q } = renderTimeline(MENTION);

    expect(q.getByText(/Database upgrade/)).toBeTruthy();
    expect(q.queryByRole("link")).toBeNull();
  });
});
