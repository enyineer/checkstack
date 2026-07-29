import { describe, expect, test } from "bun:test";
import {
  buildMentionHref,
  buildMentionMarkdown,
  extractMentions,
  isMentionHref,
  parseMentionHref,
} from "./mention-links";

describe("buildMentionHref / parseMentionHref", () => {
  test("round-trips a reference", () => {
    const ref = { type: "incident", id: "9f1c-abc" };
    expect(parseMentionHref({ href: buildMentionHref(ref) })).toEqual(ref);
  });

  test("ignores an ordinary URL", () => {
    // This runs over EVERY link in every rendered document, so the common case
    // must simply pass through.
    expect(
      parseMentionHref({ href: "https://example.com/incidents/1" }),
    ).toBeUndefined();
  });

  test("ignores a missing href", () => {
    expect(parseMentionHref({})).toBeUndefined();
  });

  test("rejects a mention with no id", () => {
    expect(parseMentionHref({ href: "checkstack:incident/" })).toBeUndefined();
  });

  test("rejects a mention with no type", () => {
    expect(parseMentionHref({ href: "checkstack:/abc" })).toBeUndefined();
  });

  test("rejects path traversal in the id", () => {
    // Anything parsed here is used to build a URL, so a permissive parser would
    // let authored text smuggle path segments into a generated link.
    expect(
      parseMentionHref({ href: "checkstack:incident/../../admin" }),
    ).toBeUndefined();
  });

  test("rejects a query string smuggled into the id", () => {
    expect(
      parseMentionHref({ href: "checkstack:incident/abc?next=evil" }),
    ).toBeUndefined();
  });

  test("rejects a scheme smuggled into the type", () => {
    expect(
      parseMentionHref({ href: "checkstack:javascript:alert(1)/x" }),
    ).toBeUndefined();
  });

  test("keeps the id intact when it contains dots and dashes", () => {
    expect(
      parseMentionHref({ href: "checkstack:maintenance/a.b-c_d" })?.id,
    ).toBe("a.b-c_d");
  });
});

describe("isMentionHref", () => {
  test("agrees with parseMentionHref", () => {
    expect(isMentionHref({ href: "checkstack:incident/abc" })).toBe(true);
    expect(isMentionHref({ href: "https://example.com" })).toBe(false);
    expect(isMentionHref({ href: "checkstack:bad" })).toBe(false);
  });
});

describe("buildMentionMarkdown", () => {
  test("produces an ordinary markdown link", () => {
    expect(
      buildMentionMarkdown({
        type: "incident",
        id: "abc",
        label: "Checkout errors",
      }),
    ).toBe("[Checkout errors](checkstack:incident/abc)");
  });

  test("round-trips a bracketed title through build then extract", () => {
    // An unescaped `]` would terminate the label early and leave the rest of
    // the title as loose text beside a malformed link.
    const markdown = buildMentionMarkdown({
      type: "incident",
      id: "abc",
      label: "Payments [EU] down",
    });

    expect(markdown).toBe("[Payments \\[EU\\] down](checkstack:incident/abc)");
    // The href is still the only thing after the label.
    expect(extractMentions({ markdown })).toEqual([
      { type: "incident", id: "abc", label: "Payments [EU] down" },
    ]);
  });
});

describe("extractMentions", () => {
  test("finds every mention in document order", () => {
    const markdown = `Related to [A](checkstack:incident/a) and [B](checkstack:maintenance/b).`;

    expect(extractMentions({ markdown })).toEqual([
      { type: "incident", id: "a", label: "A" },
      { type: "maintenance", id: "b", label: "B" },
    ]);
  });

  test("de-duplicates repeated references", () => {
    const markdown = `[A](checkstack:incident/a) ... again [A](checkstack:incident/a)`;

    expect(extractMentions({ markdown })).toHaveLength(1);
  });

  test("ignores ordinary links", () => {
    const markdown = `See the [runbook](https://example.com/runbook).`;

    expect(extractMentions({ markdown })).toEqual([]);
  });

  test("ignores a malformed mention rather than inventing a reference", () => {
    const markdown = `[bad](checkstack:incident/../x)`;

    expect(extractMentions({ markdown })).toEqual([]);
  });

  test("returns nothing for text with no links at all", () => {
    expect(extractMentions({ markdown: "plain text" })).toEqual([]);
  });

  test("tolerates whitespace inside the link parens", () => {
    expect(
      extractMentions({ markdown: "[A]( checkstack:incident/a )" }),
    ).toEqual([{ type: "incident", id: "a", label: "A" }]);
  });
});

describe("mention labels cannot break the link syntax", () => {
  /**
   * A record title is arbitrary operator text. If it can terminate the markdown
   * link early, the reference silently disappears from BOTH the rendered link
   * and the derived "Referenced items" list - a broken reference that looks
   * like prose.
   */
  const titles = [
    "Payments [EU] down",
    "Checkout ](evil.example.com) outage",
    "[bracketed]",
    "back\\slash",
    "100% of requests",
    "](x)",
  ];

  test.each(titles)("title %j round-trips through build -> extract", (label) => {
    const markdown = buildMentionMarkdown({
      type: "incident",
      id: "abc-123",
      label,
    });

    expect(extractMentions({ markdown })).toEqual([
      { type: "incident", id: "abc-123", label },
    ]);
  });

  test("a hostile title cannot inject a SECOND reference", () => {
    // The `](checkstack:...)` inside the title must stay inert text.
    const markdown = buildMentionMarkdown({
      type: "incident",
      id: "real",
      label: "evil](checkstack:incident/injected) tail",
    });

    const found = extractMentions({ markdown });
    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe("real");
  });
});
