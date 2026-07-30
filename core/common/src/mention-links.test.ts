import { describe, expect, test } from "bun:test";
import {
  buildMentionHref,
  buildMentionMarkdown,
  extractMentions,
  isMentionHref,
  parseMentionHref,
  rewriteMentions,
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

describe("rewriteMentions", () => {
  const linkTo = (url: string) => () => url;

  test("rewrites a mention to the resolved URL", () => {
    const markdown = `See ${buildMentionMarkdown({
      type: "maintenance",
      id: "m1",
      label: "Database upgrade",
    })} for details.`;

    expect(
      rewriteMentions({ markdown, resolve: linkTo("/maintenance/m1") }),
    ).toBe("See [Database upgrade](/maintenance/m1) for details.");
  });

  test("FLATTENS an unresolved mention to its label, dropping the link", () => {
    // The whole point: a `checkstack:` href is meaningless outside a renderer
    // that understands it, and channels leak it differently - Slack would emit
    // `<checkstack:maintenance/m1|Database upgrade>` to the recipient.
    const markdown = `See ${buildMentionMarkdown({
      type: "maintenance",
      id: "m1",
      label: "Database upgrade",
    })} for details.`;

    const out = rewriteMentions({ markdown, resolve: () => undefined });

    expect(out).toBe("See Database upgrade for details.");
    expect(out).not.toContain("checkstack:");
  });

  test("resolves each mention independently", () => {
    const markdown = [
      buildMentionMarkdown({ type: "incident", id: "i1", label: "Outage" }),
      buildMentionMarkdown({ type: "incident", id: "i2", label: "Secret" }),
    ].join(" and ");

    const out = rewriteMentions({
      markdown,
      resolve: ({ id }) => (id === "i1" ? "/incident/i1" : undefined),
    });

    expect(out).toBe("[Outage](/incident/i1) and Secret");
  });

  test("leaves ordinary links untouched", () => {
    const markdown = "See [the docs](https://example.com/a(b)) please.";
    expect(rewriteMentions({ markdown, resolve: linkTo("/nope") })).toBe(
      markdown,
    );
  });

  test("leaves text with no links at all untouched", () => {
    const markdown = "Plain **prose** with `code` and a list:\n- one\n- two";
    expect(rewriteMentions({ markdown, resolve: linkTo("/x") })).toBe(markdown);
  });

  test("preserves an escaped label so brackets stay literal", () => {
    const label = "Outage [EU-West]";
    const markdown = buildMentionMarkdown({
      type: "incident",
      id: "i1",
      label,
    });

    // Escapes stay intact in both directions, so the rendered text reads as the
    // author's title rather than forming new markdown syntax.
    expect(rewriteMentions({ markdown, resolve: linkTo("/i/1") })).toBe(
      String.raw`[Outage \[EU-West\]](/i/1)`,
    );
    expect(rewriteMentions({ markdown, resolve: () => undefined })).toBe(
      String.raw`Outage \[EU-West\]`,
    );
  });

  test("a hostile label cannot inject a second link when flattened", () => {
    const markdown = buildMentionMarkdown({
      type: "incident",
      id: "real",
      label: "evil](checkstack:incident/injected) tail",
    });

    const out = rewriteMentions({ markdown, resolve: () => undefined });

    // The injected `](checkstack:...)` survives only as ESCAPED text. What
    // matters is that no renderer can pick a reference back out of it - the
    // escape keeps the bracket literal, so the injected href never becomes a
    // link destination in any channel.
    expect(out).toContain(String.raw`\]`);
    expect(extractMentions({ markdown: out })).toEqual([]);
  });

  test("a resolved hostile label still yields exactly ONE link", () => {
    const markdown = buildMentionMarkdown({
      type: "incident",
      id: "real",
      label: "evil](checkstack:incident/injected) tail",
    });

    const out = rewriteMentions({ markdown, resolve: () => "/incident/real" });

    // The escaped bracket keeps the whole title inside the label, so the only
    // destination is the one the resolver chose.
    expect(out).toBe(
      String.raw`[evil\](checkstack:incident/injected) tail](/incident/real)`,
    );
    expect(extractMentions({ markdown: out })).toEqual([]);
  });

  test("fails CLOSED for a URL that would break out of the link destination", () => {
    // A resolver should never produce one, but if it did, an unescaped space or
    // paren would terminate the destination early and leave the remainder as
    // loose markdown next to a malformed link.
    const markdown = buildMentionMarkdown({
      type: "incident",
      id: "i1",
      label: "Outage",
    });

    for (const bad of ["/a b", "/a(b)", "/a)x", "/a<b>"]) {
      expect(rewriteMentions({ markdown, resolve: () => bad })).toBe("Outage");
    }
  });

  test("rewrites EVERY occurrence, not just the first", () => {
    // A `g` regex kept across calls carries `lastIndex` and skips matches.
    const one = buildMentionMarkdown({ type: "incident", id: "i1", label: "A" });
    const markdown = `${one} ${one} ${one}`;

    expect(rewriteMentions({ markdown, resolve: linkTo("/x") })).toBe(
      "[A](/x) [A](/x) [A](/x)",
    );
  });

  test("is stable across repeated calls", () => {
    const markdown = buildMentionMarkdown({
      type: "incident",
      id: "i1",
      label: "A",
    });

    const first = rewriteMentions({ markdown, resolve: linkTo("/x") });
    const second = rewriteMentions({ markdown, resolve: linkTo("/x") });
    expect(second).toBe(first);
  });

  test("passes the parsed ref to the resolver", () => {
    const seen: Array<{ type: string; id: string }> = [];
    rewriteMentions({
      markdown: buildMentionMarkdown({
        type: "maintenance",
        id: "m-9",
        label: "L",
      }),
      resolve: (ref) => {
        seen.push(ref);
        return undefined;
      },
    });

    expect(seen).toEqual([{ type: "maintenance", id: "m-9" }]);
  });

  test("leaves a malformed checkstack link untouched rather than mangling it", () => {
    // Not a well-formed mention (no id), so it is not this function's to edit.
    const markdown = "[x](checkstack:incident)";
    expect(rewriteMentions({ markdown, resolve: linkTo("/x") })).toBe(markdown);
  });
});

describe("mention scanning stays linear on hostile input", () => {
  /**
   * REGRESSION: the label class once allowed a raw `[`, so a run of `[[[[`
   * started a label scan at every bracket that could only fail at the closing
   * `](` - quadratic in the input length (CodeQL js/polynomial-redos, HIGH).
   *
   * These documents are operator-authored update text, so the input is
   * genuinely uncontrolled. Asserting a time BOUND is the only way to catch a
   * regression here: a quadratic pattern still returns the right answer, just
   * far too slowly, so every correctness test would keep passing.
   */
  const hostile = (n: number) => "[".repeat(n) + "](checkstack:incident/x)";

  test("a long run of brackets does not blow up", () => {
    const started = performance.now();
    extractMentions({ markdown: hostile(20_000) });
    const elapsed = performance.now() - started;

    // Quadratic took seconds at this size; linear is single-digit ms. The
    // bound is deliberately loose so a slow CI runner cannot flake it.
    expect(elapsed).toBeLessThan(1000);
  });

  test("scales roughly linearly, not quadratically", () => {
    const time = (n: number) => {
      const started = performance.now();
      extractMentions({ markdown: hostile(n) });
      return performance.now() - started;
    };
    time(4000); // warm up, so JIT does not skew the first measurement

    const small = time(4000);
    const large = time(16_000);

    // 4x the input. Linear predicts ~4x; quadratic predicts ~16x. Allow a very
    // generous factor so this measures the COMPLEXITY CLASS, not the machine.
    expect(large).toBeLessThan(Math.max(small, 1) * 40);
  });

  test("a long run of `[](checkstack:` does not blow up", () => {
    // The shape CodeQL actually named. The HREF class was the real culprit:
    // `[^\s)]+` consumed the whole remaining string, then gave back one
    // character per failed `)` attempt, at every start position.
    const hostile = "[](checkstack:".repeat(20_000);

    const started = performance.now();
    extractMentions({ markdown: hostile });
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(1000);
  });

  test("still finds a mention whose label has ESCAPED brackets", () => {
    // The fix must not cost the bracketed-title case, which is what
    // buildMentionMarkdown actually emits.
    const markdown = buildMentionMarkdown({
      type: "incident",
      id: "abc",
      label: "Payments [EU] down",
    });

    expect(extractMentions({ markdown })).toEqual([
      { type: "incident", id: "abc", label: "Payments [EU] down" },
    ]);
  });
});
