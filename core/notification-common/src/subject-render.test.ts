import { describe, expect, it } from "bun:test";
import {
  SUBJECT_STATUS_EMOJI,
  renderSubjectLabel,
  renderSubjectsAsHtml,
  renderSubjectsAsMarkdown,
  renderSubjectsAsPlainText,
} from "./subject-render";
import type { NotificationSubject } from "./schemas";

const subject = (
  overrides: Partial<NotificationSubject> = {},
): NotificationSubject => ({
  kind: "catalog.system",
  id: "1",
  name: "Checkout",
  ...overrides,
});

describe("renderSubjectsAsPlainText", () => {
  it("returns an empty string for an empty list", () => {
    expect(renderSubjectsAsPlainText({ subjects: [] })).toBe("");
  });

  it("renders a name with its url in parentheses", () => {
    expect(
      renderSubjectsAsPlainText({
        subjects: [subject({ url: "https://x.test/c" })],
      }),
    ).toBe("Affected:\n• Checkout (https://x.test/c)");
  });

  it("renders a name only when no url is present", () => {
    expect(renderSubjectsAsPlainText({ subjects: [subject()] })).toBe(
      "Affected:\n• Checkout",
    );
  });

  it("prefixes the status emoji in place of the bullet when status is set", () => {
    expect(
      renderSubjectsAsPlainText({
        subjects: [subject({ status: "unhealthy" })],
      }),
    ).toBe(`Affected:\n${SUBJECT_STATUS_EMOJI.unhealthy} Checkout`);
  });

  it("renders multiple subjects one per line", () => {
    expect(
      renderSubjectsAsPlainText({
        subjects: [
          subject({ name: "A" }),
          subject({ id: "2", name: "B", url: "https://x.test/b" }),
        ],
      }),
    ).toBe("Affected:\n• A\n• B (https://x.test/b)");
  });

  it("omits the heading when heading is null", () => {
    expect(
      renderSubjectsAsPlainText({ subjects: [subject()], heading: null }),
    ).toBe("• Checkout");
  });
});

describe("renderSubjectsAsMarkdown", () => {
  it("returns an empty string for an empty list", () => {
    expect(renderSubjectsAsMarkdown({ subjects: [] })).toBe("");
  });

  it("renders a markdown link when a url is present", () => {
    expect(
      renderSubjectsAsMarkdown({
        subjects: [subject({ url: "https://x.test/c" })],
      }),
    ).toBe("**Affected:**\n• [Checkout](https://x.test/c)");
  });

  it("renders a plain name when no url is present", () => {
    expect(renderSubjectsAsMarkdown({ subjects: [subject()] })).toBe(
      "**Affected:**\n• Checkout",
    );
  });

  it("uses slack link syntax when linkStyle is slack", () => {
    expect(
      renderSubjectsAsMarkdown({
        subjects: [subject({ url: "https://x.test/c" })],
        linkStyle: "slack",
      }),
    ).toBe("*Affected:*\n• <https://x.test/c|Checkout>");
  });

  it("prefixes the status emoji in place of the bullet when status is set", () => {
    expect(
      renderSubjectsAsMarkdown({
        subjects: [subject({ status: "degraded", url: "https://x.test/c" })],
      }),
    ).toBe(
      `**Affected:**\n${SUBJECT_STATUS_EMOJI.degraded} [Checkout](https://x.test/c)`,
    );
  });

  it("omits the heading when heading is null", () => {
    expect(
      renderSubjectsAsMarkdown({ subjects: [subject()], heading: null }),
    ).toBe("• Checkout");
  });
});

describe("renderSubjectLabel", () => {
  it("prefixes a plain bullet when no status is set", () => {
    expect(renderSubjectLabel({ subject: subject() })).toBe("• Checkout");
  });

  it("prefixes the status emoji when status is set", () => {
    expect(
      renderSubjectLabel({ subject: subject({ status: "unhealthy" }) }),
    ).toBe(`${SUBJECT_STATUS_EMOJI.unhealthy} Checkout`);
  });

  it("ignores the url (rich-card channels lay it out separately)", () => {
    expect(
      renderSubjectLabel({ subject: subject({ url: "https://x.test/c" }) }),
    ).toBe("• Checkout");
  });

  it("honors a custom bullet", () => {
    expect(renderSubjectLabel({ subject: subject(), bullet: "-" })).toBe(
      "- Checkout",
    );
  });
});

describe("renderSubjectsAsHtml", () => {
  it("returns an empty string for an empty list", () => {
    expect(renderSubjectsAsHtml({ subjects: [] })).toBe("");
  });

  it("renders an anchor when a url is present", () => {
    expect(
      renderSubjectsAsHtml({ subjects: [subject({ url: "https://x.test/c" })] }),
    ).toBe('<b>Affected:</b><ul><li><a href="https://x.test/c">Checkout</a></li></ul>');
  });

  it("renders the bare name with no leading marker when status-less", () => {
    expect(renderSubjectsAsHtml({ subjects: [subject()] })).toBe(
      "<b>Affected:</b><ul><li>Checkout</li></ul>",
    );
  });

  it("prefixes the status emoji when status is set", () => {
    expect(
      renderSubjectsAsHtml({ subjects: [subject({ status: "degraded" })] }),
    ).toBe(
      `<b>Affected:</b><ul><li>${SUBJECT_STATUS_EMOJI.degraded} Checkout</li></ul>`,
    );
  });

  it("escapes html in names and urls", () => {
    expect(
      renderSubjectsAsHtml({
        subjects: [
          subject({ name: "<b>A&B</b>", url: 'https://x.test/?a="1"&b=2' }),
        ],
      }),
    ).toBe(
      '<b>Affected:</b><ul><li><a href="https://x.test/?a=&quot;1&quot;&amp;b=2">&lt;b&gt;A&amp;B&lt;/b&gt;</a></li></ul>',
    );
  });

  it("renders multiple subjects as separate list items", () => {
    expect(
      renderSubjectsAsHtml({
        subjects: [subject({ name: "A" }), subject({ id: "2", name: "B" })],
      }),
    ).toBe("<b>Affected:</b><ul><li>A</li><li>B</li></ul>");
  });

  it("omits the heading when heading is null", () => {
    expect(
      renderSubjectsAsHtml({ subjects: [subject()], heading: null }),
    ).toBe("<ul><li>Checkout</li></ul>");
  });
});
