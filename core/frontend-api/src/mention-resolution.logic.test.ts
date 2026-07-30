import { describe, expect, test } from "bun:test";
import { buildMentionMarkdown } from "@checkstack/common";
import {
  MAX_MENTION_REFS,
  collectMentionRefs,
  mentionRefsKey,
  resolveViewableRoute,
} from "./mention-resolution.logic";

const ref = (type: string, id: string) => ({ type, id });
const link = (type: string, id: string, label = "Label") =>
  buildMentionMarkdown({ type, id, label });

describe("collectMentionRefs", () => {
  test("collects references across every document", () => {
    const refs = collectMentionRefs({
      documents: [
        `Caused by ${link("maintenance", "m1")}`,
        `Related: ${link("incident", "i1")}`,
      ],
    });

    expect(refs).toEqual([ref("maintenance", "m1"), ref("incident", "i1")]);
  });

  test("de-duplicates the same reference ACROSS documents", () => {
    // A detail page passes the description plus every update. The same
    // reference repeated in five updates must cost one lookup, not five.
    const refs = collectMentionRefs({
      documents: [
        link("incident", "i1"),
        `again ${link("incident", "i1")}`,
        `and again ${link("incident", "i1")}`,
      ],
    });

    expect(refs).toEqual([ref("incident", "i1")]);
  });

  test("keeps first-appearance order", () => {
    const refs = collectMentionRefs({
      documents: [`${link("incident", "b")} then ${link("incident", "a")}`],
    });

    expect(refs.map((r) => r.id)).toEqual(["b", "a"]);
  });

  test("ignores empty and whitespace-only documents", () => {
    expect(collectMentionRefs({ documents: ["", "   ", "\n"] })).toEqual([]);
  });

  test("a document with no mentions contributes nothing", () => {
    expect(
      collectMentionRefs({
        documents: ["Plain prose with [a link](https://example.com)."],
      }),
    ).toEqual([]);
  });

  test("caps the batch at MAX_MENTION_REFS", () => {
    // Over the cap the backend would reject the WHOLE request, and since the
    // resolver fails closed that would silently downgrade every mention on the
    // page - exactly when links matter most. Truncating keeps the first N.
    const documents = Array.from({ length: MAX_MENTION_REFS + 50 }, (_, i) =>
      link("incident", `i${i}`),
    );

    expect(collectMentionRefs({ documents })).toHaveLength(MAX_MENTION_REFS);
  });

  test("the cap never exceeds what the resolving procedures accept", () => {
    // `resolveIncidentRefs` / `resolveMaintenanceRefs` declare `.max(200)`.
    expect(MAX_MENTION_REFS).toBeLessThanOrEqual(200);
  });

  test("truncation keeps the FIRST refs, in order", () => {
    const documents = Array.from({ length: 10 }, (_, i) =>
      link("incident", `i${i}`),
    );

    expect(
      collectMentionRefs({ documents, limit: 3 }).map((r) => r.id),
    ).toEqual(["i0", "i1", "i2"]);
  });

  test("collects a reference whose label contains escaped brackets", () => {
    // buildMentionMarkdown escapes brackets in the title; a reference must not
    // be lost because the author's title happened to contain one.
    const refs = collectMentionRefs({
      documents: [link("incident", "i1", "Outage [EU-West]")],
    });

    expect(refs).toEqual([ref("incident", "i1")]);
  });
});

describe("mentionRefsKey", () => {
  test("is order-independent, so reordered prose does not refetch", () => {
    const a = mentionRefsKey({
      refs: [ref("incident", "i1"), ref("maintenance", "m1")],
    });
    const b = mentionRefsKey({
      refs: [ref("maintenance", "m1"), ref("incident", "i1")],
    });

    expect(a).toBe(b);
  });

  test("distinguishes different reference sets", () => {
    expect(mentionRefsKey({ refs: [ref("incident", "i1")] })).not.toBe(
      mentionRefsKey({ refs: [ref("incident", "i2")] }),
    );
  });

  test("distinguishes the same id under different types", () => {
    expect(mentionRefsKey({ refs: [ref("incident", "x")] })).not.toBe(
      mentionRefsKey({ refs: [ref("maintenance", "x")] }),
    );
  });

  test("is empty for no refs, which callers use to skip the query", () => {
    expect(mentionRefsKey({ refs: [] })).toBe("");
  });
});

describe("resolveViewableRoute", () => {
  const toRoute = ({ type, id }: { type: string; id: string }) =>
    `/${type}/${id}`;

  test("links a reference the viewer may read", () => {
    expect(
      resolveViewableRoute({
        ref: ref("incident", "i1"),
        viewable: new Set(["incident/i1"]),
        toRoute,
      }),
    ).toBe("/incident/i1");
  });

  test("withholds the link for a reference the viewer may NOT read", () => {
    expect(
      resolveViewableRoute({
        ref: ref("incident", "secret"),
        viewable: new Set(["incident/i1"]),
        toRoute,
      }),
    ).toBeUndefined();
  });

  test("withholds the link while the check is still in flight", () => {
    // The fail-closed direction: plain-text-then-link only ever reveals what
    // the check confirmed. Link-then-withdraw would flash a reference the
    // viewer may not be entitled to see.
    expect(
      resolveViewableRoute({
        ref: ref("incident", "i1"),
        viewable: undefined,
        toRoute,
      }),
    ).toBeUndefined();
  });

  test("withholds the link when nothing is viewable", () => {
    expect(
      resolveViewableRoute({
        ref: ref("incident", "i1"),
        viewable: new Set(),
        toRoute,
      }),
    ).toBeUndefined();
  });

  test("respects a router that declines an otherwise-viewable type", () => {
    // An unregistered type resolves to no route even when readable, so a
    // reference to a plugin that is not installed stays plain text.
    expect(
      resolveViewableRoute({
        ref: ref("unknown", "x"),
        viewable: new Set(["unknown/x"]),
        toRoute: () => undefined,
      }),
    ).toBeUndefined();
  });

  test("does not confuse the same id across two types", () => {
    const viewable = new Set(["incident/shared"]);

    expect(
      resolveViewableRoute({ ref: ref("incident", "shared"), viewable, toRoute }),
    ).toBe("/incident/shared");
    expect(
      resolveViewableRoute({
        ref: ref("maintenance", "shared"),
        viewable,
        toRoute,
      }),
    ).toBeUndefined();
  });
});
