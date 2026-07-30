import "@checkstack/test-utils-frontend/setup";
import { describe, expect, it, mock } from "bun:test";
import { render } from "@testing-library/react";
import { Markdown, MarkdownBlock } from "./Markdown";

/**
 * The mention href has to survive the renderer's SANITIZER to reach the anchor
 * component at all.
 *
 * `Markdown` runs `rehype-raw` then `rehype-sanitize`, and sanitizers
 * allow-list URL protocols (`http`, `https`, `mailto`, ...). `checkstack:` is
 * not one of them, so an un-extended schema silently drops the href - and the
 * anchor renderer then sees no mention, takes the ordinary-link branch, and
 * emits an `<a>` with no href. Visually the label still appears, so the failure
 * is invisible: the text is there, only the link is missing, and nothing
 * throws.
 *
 * These tests pin the whole path from authored markdown to a resolved link.
 */
describe("Markdown renders cross-entity mentions", () => {
  const MENTION = "[Database upgrade](checkstack:maintenance/abc-123)";

  it("hands the mention to the resolver", () => {
    const resolveMention = mock(() => "/maintenance/abc-123");

    render(<Markdown resolveMention={resolveMention}>{MENTION}</Markdown>);

    expect(resolveMention).toHaveBeenCalledWith({
      type: "maintenance",
      id: "abc-123",
    });
  });

  it("renders a resolved mention as a real link", () => {
    const { getByRole } = render(
      <Markdown resolveMention={() => "/maintenance/abc-123"}>
        {MENTION}
      </Markdown>,
    );

    const link = getByRole("link", { name: "Database upgrade" });
    expect(link.getAttribute("href")).toBe("/maintenance/abc-123");
  });

  it("renders an UNRESOLVED mention as plain text, never a dead link", () => {
    const { queryByRole, getByText } = render(
      <Markdown resolveMention={() => undefined}>{MENTION}</Markdown>,
    );

    expect(getByText("Database upgrade")).toBeTruthy();
    expect(queryByRole("link")).toBeNull();
  });

  it("MarkdownBlock resolves mentions too", () => {
    const { getByRole } = render(
      <MarkdownBlock resolveMention={() => "/maintenance/abc-123"}>
        {MENTION}
      </MarkdownBlock>,
    );

    expect(
      getByRole("link", { name: "Database upgrade" }).getAttribute("href"),
    ).toBe("/maintenance/abc-123");
  });

  it("still renders an ordinary external link", () => {
    const { getByRole } = render(
      <Markdown>{"[docs](https://example.com/x)"}</Markdown>,
    );

    expect(getByRole("link", { name: "docs" }).getAttribute("href")).toBe(
      "https://example.com/x",
    );
  });

  it("does NOT treat an ordinary link as a mention", () => {
    const resolveMention = mock(() => "/nope");

    render(
      <Markdown resolveMention={resolveMention}>
        {"[docs](https://example.com/x)"}
      </Markdown>,
    );

    expect(resolveMention).not.toHaveBeenCalled();
  });

  it("drops a javascript: href, which the sanitizer must still refuse", () => {
    // Widening the protocol allow-list for `checkstack:` must not widen it for
    // anything executable.
    const { queryByRole } = render(
      // eslint-disable-next-line no-script-url -- the point of the test
      <Markdown>{"[click](javascript:alert(1))"}</Markdown>,
    );

    const link = queryByRole("link");
    expect(link?.getAttribute("href") ?? "").not.toContain("javascript:");
  });
});
