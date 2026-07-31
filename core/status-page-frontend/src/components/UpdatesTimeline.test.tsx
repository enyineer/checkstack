import "@checkstack/test-utils-frontend/setup";
import { describe, expect, it } from "bun:test";
import { render, within } from "@testing-library/react";
import {
  UpdatesTimeline,
  INCIDENT_STATUS_PRESENTER,
  type PublicUpdate,
} from "./UpdatesTimeline";

/**
 * Two reported bugs, one root cause: the timeline rendered update bodies with
 * the INLINE `<Markdown>`, which maps every paragraph to a `<span>` and has no
 * heading / list renderers at all. So authored markdown looked unrendered, AND
 * the status label - an inline-block right before it - flowed onto the same
 * line as the first paragraph with no gap ("IDENTIFIEDWe found the cause").
 *
 * These pin the block rendering, which is what keeps the label on its own line.
 */

const AT = "2026-07-01T01:00:00Z";

/** Scoped queries: RTL's destructured ones bind to `document.body`, so repeated
 * text across tests in one file collides when cleanup does not run between. */
function renderTimeline(updates: PublicUpdate[]) {
  const result = render(
    <UpdatesTimeline
      updates={updates}
      status={INCIDENT_STATUS_PRESENTER}
      fallbackTone="down"
    />
  );
  return { ...result, q: within(result.container) };
}

describe("UpdatesTimeline renders update bodies as block markdown", () => {
  it("renders a paragraph as a block <p>, not an inline <span>", () => {
    // The inline renderer emitted `<span>`; a `<p>` is what stops the status
    // label above from sharing its line.
    const { q } = renderTimeline([
      { message: "We found the cause.", statusChange: "identified", at: AT },
    ]);

    const message = q.getByText("We found the cause.");
    expect(message.tagName).toBe("P");
  });

  it("renders markdown headings and lists as real elements", () => {
    const { q, container } = renderTimeline([
      {
        message: "## Impact\n\n- Checkout is down\n- Search is slow",
        at: AT,
      },
    ]);

    expect(q.getByRole("heading", { name: "Impact" }).tagName).toBe("H2");
    // Scoped to the message's own `<ul>` - the timeline itself is an `<ol>` of
    // entries, so an unscoped listitem query also matches the entry row.
    const bullets = container.querySelector("ul");
    expect(
      Array.from(bullets?.children ?? []).map((li) => li.textContent)
    ).toEqual(["Checkout is down", "Search is slow"]);
  });

  it("keeps separate paragraphs separate", () => {
    // The inline renderer ran both into one line of text.
    const { q } = renderTimeline([
      { message: "First para.\n\nSecond para.", at: AT },
    ]);

    expect(q.getByText("First para.").tagName).toBe("P");
    expect(q.getByText("Second para.").tagName).toBe("P");
  });

  it("renders emphasis rather than leaking the markdown source", () => {
    const { q } = renderTimeline([{ message: "A **hard** outage", at: AT }]);

    expect(q.getByText("hard").tagName).toBe("STRONG");
    expect(q.queryByText(/\*\*/)).toBeNull();
  });
});

describe("UpdatesTimeline status label", () => {
  it("renders the label on its OWN line, outside the message", () => {
    const { q } = renderTimeline([
      { message: "We found the cause.", statusChange: "identified", at: AT },
    ]);

    const label = q.getByText("Identified");
    // `block`, never `inline-block` - the inline-block variant is exactly what
    // let the label sit flush against the message with no gap.
    expect(label.className).toContain("block");
    expect(label.className).not.toContain("inline-block");
    // And it is a sibling of the message, not an ancestor of it.
    expect(label.textContent).toBe("Identified");
  });

  it("omits the label entirely for an update that changes no status", () => {
    const { q } = renderTimeline([{ message: "Still working on it.", at: AT }]);

    expect(q.queryByText("Identified")).toBeNull();
    expect(q.getByText("Still working on it.")).toBeTruthy();
  });
});

describe("UpdatesTimeline rail dot", () => {
  /** The dot classes down the rail, oldest last (input order is newest first). */
  const dotClasses = (container: Element) =>
    Array.from(container.querySelectorAll("li > span.rounded-full")).map(
      (dot) => dot.className
    );

  it("colours each dot by that update's own status change", () => {
    const { container } = renderTimeline([
      { message: "Recovering.", statusChange: "monitoring", at: AT },
      { message: "Found it.", statusChange: "identified", at: AT },
    ]);

    expect(dotClasses(container)[0]).toContain("bg-status-info"); // monitoring
    expect(dotClasses(container)[1]).toContain("bg-status-warn"); // identified
  });

  it("carries the last status forward to a changeless update", () => {
    // The reported bug: this dot was `bg-border` - all but invisible on the
    // page - even though the incident was plainly still "identified".
    const { container } = renderTimeline([
      { message: "Still working on it.", at: AT },
      { message: "Found it.", statusChange: "identified", at: AT },
    ]);

    expect(dotClasses(container)[0]).toContain("bg-status-warn");
    expect(dotClasses(container)[0]).not.toContain("bg-border");
  });

  it("never back-fills a NEWER status onto an older update", () => {
    // Input is newest first, so the changeless entry is OLDER than the
    // resolution and must not be painted "resolved" green.
    const { container } = renderTimeline([
      { message: "All clear.", statusChange: "resolved", at: AT },
      { message: "Investigating impact.", at: AT },
    ]);

    expect(dotClasses(container)[0]).toContain("bg-status-ok");
    expect(dotClasses(container)[1]).not.toContain("bg-status-ok");
  });

  it("falls back to the event's own tone when no status is known yet", () => {
    // The widget caps its update count, so the window can start part-way
    // through a history. `fallbackTone="down"` stands in for the incident's
    // severity here.
    const { container } = renderTimeline([{ message: "Update.", at: AT }]);

    expect(dotClasses(container)[0]).toContain("bg-status-down");
  });
});

describe("UpdatesTimeline mentions", () => {
  const MENTION = "See [Database upgrade](checkstack:maintenance/abc-123).";

  it("links a resolved mention inside a block-rendered body", () => {
    const result = render(
      <UpdatesTimeline
        updates={[{ message: MENTION, at: AT }]}
        status={INCIDENT_STATUS_PRESENTER}
        fallbackTone="down"
        resolveMention={() => "/view/acme/maintenance/abc-123"}
      />
    );

    expect(
      within(result.container)
        .getByRole("link", { name: "Database upgrade" })
        .getAttribute("href")
    ).toBe("/view/acme/maintenance/abc-123");
  });

  it("renders a mention as plain text with no resolver", () => {
    // The confidentiality default: an unresolvable reference must not become a
    // link that confirms the item exists.
    const { q } = renderTimeline([{ message: MENTION, at: AT }]);

    expect(q.getByText(/Database upgrade/)).toBeTruthy();
    expect(q.queryByRole("link")).toBeNull();
  });
});

describe("UpdatesTimeline empty state", () => {
  it("renders nothing when there are no updates", () => {
    const { container } = renderTimeline([]);
    expect(container.querySelector("ol")).toBeNull();
  });
});
