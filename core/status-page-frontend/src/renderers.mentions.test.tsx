import "@checkstack/test-utils-frontend/setup";
import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";
import { BUILTIN_WIDGET_IDS } from "@checkstack/status-page-common";
import { BlockRenderer, StatusMentionContext } from "./renderers";
import { useStatusWidgetRenderers } from "./renderers";

/**
 * Mention resolution on a PUBLIC page flows through `StatusMentionContext`,
 * not through props - a different path from the detail pages, and the one the
 * status page itself uses.
 *
 * These cover the two widgets that render authored markdown: the event feed's
 * update messages, and the Text content block. Both were wired to the context
 * with nothing exercising them; the Text block in particular had no coverage of
 * any kind.
 */

const MENTION = "[Database upgrade](checkstack:maintenance/abc-123)";

/** Renders one block through the real renderer registry, inside the context. */
function renderBlock({
  type,
  data,
  resolveMention,
}: {
  type: string;
  data: unknown;
  resolveMention: ((ref: { type: string; id: string }) => string | undefined) | null;
}) {
  const Harness = () => {
    const renderers = useStatusWidgetRenderers();
    return (
      <StatusMentionContext.Provider value={resolveMention}>
        <BlockRenderer
          block={{ id: "b1", type, data }}
          renderers={renderers}
        />
      </StatusMentionContext.Provider>
    );
  };
  return render(<Harness />);
}

describe("Text block resolves mentions through the context", () => {
  it("renders a resolved mention as a link", () => {
    const { getByRole } = renderBlock({
      type: BUILTIN_WIDGET_IDS.text,
      data: { markdown: `See ${MENTION} for details.` },
      resolveMention: () => "/view/acme/maintenance/abc-123",
    });

    expect(
      getByRole("link", { name: "Database upgrade" }).getAttribute("href"),
    ).toBe("/view/acme/maintenance/abc-123");
  });

  it("renders an UNRESOLVED mention as plain text", () => {
    // The confidentiality direction: a reference this page does not publish
    // must not become a link, because a dead link still confirms it exists.
    const { queryByRole, getByText } = renderBlock({
      type: BUILTIN_WIDGET_IDS.text,
      data: { markdown: `See ${MENTION} for details.` },
      resolveMention: () => undefined,
    });

    expect(getByText(/Database upgrade/)).toBeTruthy();
    expect(queryByRole("link")).toBeNull();
  });

  it("renders plain text when no resolver is provided at all", () => {
    // The builder preview provides none.
    const { queryByRole } = renderBlock({
      type: BUILTIN_WIDGET_IDS.text,
      data: { markdown: MENTION },
      resolveMention: null,
    });

    expect(queryByRole("link")).toBeNull();
  });
});

describe("event-feed updates resolve mentions through the context", () => {
  const incidentData = {
    incidents: [
      {
        id: "inc-1",
        title: "Checkout errors",
        status: "monitoring",
        severity: "major",
        systems: ["Payments"],
        startedAt: "2026-07-01T00:00:00Z",
        updates: [{ message: `Caused by ${MENTION}`, at: "2026-07-01T01:00:00Z" }],
      },
    ],
  };

  it("renders a resolved mention in an update as a link", () => {
    const { getByRole } = renderBlock({
      type: BUILTIN_WIDGET_IDS.incidents,
      data: incidentData,
      resolveMention: () => "/view/acme/maintenance/abc-123",
    });

    expect(
      getByRole("link", { name: "Database upgrade" }).getAttribute("href"),
    ).toBe("/view/acme/maintenance/abc-123");
  });

  it("renders an unresolved mention in an update as plain text", () => {
    const { queryByRole, getByText } = renderBlock({
      type: BUILTIN_WIDGET_IDS.incidents,
      data: incidentData,
      resolveMention: () => undefined,
    });

    expect(getByText(/Database upgrade/)).toBeTruthy();
    expect(
      queryByRole("link", { name: "Database upgrade" }),
    ).toBeNull();
  });
});
