import { describe, expect, test } from "bun:test";
import { buildMentionMarkdown } from "@checkstack/common";
import {
  collectRefsFromValue,
  publicRefKey,
  resolvePublicMentionHref,
  toDetailKind,
} from "./public-mentions.logic";

const link = (type: string, id: string, label = "Label") =>
  buildMentionMarkdown({ type, id, label });

describe("collectRefsFromValue", () => {
  test("finds a reference in a nested widget DTO", () => {
    // The page renders a heterogeneous list of widget DTOs whose shapes it does
    // not know, so the scan is structural rather than per-widget.
    const blocks = [
      {
        id: "b1",
        type: "statuspage.incidents",
        data: {
          incidents: [
            { id: "i1", updates: [{ message: `Caused by ${link("maintenance", "m1")}` }] },
          ],
        },
      },
    ];

    expect(collectRefsFromValue({ value: blocks })).toEqual([
      { type: "maintenance", id: "m1" },
    ]);
  });

  test("de-duplicates a reference repeated across blocks", () => {
    const blocks = [
      { data: { updates: [{ message: link("incident", "i1") }] } },
      { data: { updates: [{ message: link("incident", "i1") }] } },
    ];

    expect(collectRefsFromValue({ value: blocks })).toEqual([
      { type: "incident", id: "i1" },
    ]);
  });

  test("returns nothing for content with no mentions", () => {
    expect(
      collectRefsFromValue({
        value: { data: { text: "All systems operational." } },
      }),
    ).toEqual([]);
  });

  test("handles undefined content (the page has not loaded yet)", () => {
    expect(collectRefsFromValue({ value: undefined })).toEqual([]);
  });

  test("ignores object KEYS, scanning only values", () => {
    // Keys are field names, never authored content.
    const value = { [link("incident", "from-key")]: "plain value" };

    expect(collectRefsFromValue({ value })).toEqual([]);
  });

  test("caps the number of refs collected", () => {
    const value = Array.from({ length: 50 }, (_, i) => link("incident", `i${i}`));

    expect(collectRefsFromValue({ value, limit: 10 })).toHaveLength(10);
  });

  test("survives a deeply nested structure", () => {
    const value = { a: { b: { c: [{ d: { e: link("incident", "deep") } }] } } };

    expect(collectRefsFromValue({ value })).toEqual([
      { type: "incident", id: "deep" },
    ]);
  });

  test("ignores non-string leaves", () => {
    const value = { n: 1, b: true, nil: null, un: undefined, d: new Date(0) };

    expect(collectRefsFromValue({ value })).toEqual([]);
  });
});

describe("toDetailKind", () => {
  test("maps the two types that have public detail pages", () => {
    expect(toDetailKind({ type: "incident" })).toBe("incident");
    expect(toDetailKind({ type: "maintenance" })).toBe("maintenance");
  });

  test("returns undefined for a type with no public page", () => {
    // There is nowhere public to send a reader, so the label stays plain text.
    expect(toDetailKind({ type: "slo" })).toBeUndefined();
    expect(toDetailKind({ type: "system" })).toBeUndefined();
  });
});

describe("resolvePublicMentionHref", () => {
  const buildDetailHref = ({
    kind,
    id,
  }: {
    kind: "incident" | "maintenance";
    id: string;
  }) => `/view/page/${kind}/${id}`;

  test("links a reference THIS page surfaces", () => {
    expect(
      resolvePublicMentionHref({
        ref: { type: "maintenance", id: "m1" },
        resolvedKeys: new Set(["maintenance/m1"]),
        buildDetailHref,
      }),
    ).toBe("/view/page/maintenance/m1");
  });

  test("withholds a reference the page does NOT surface", () => {
    // The confidentiality case: an internal-only incident referenced from a
    // public update must stay plain text. A dead link would still confirm it
    // exists.
    expect(
      resolvePublicMentionHref({
        ref: { type: "incident", id: "internal-only" },
        resolvedKeys: new Set(["maintenance/m1"]),
        buildDetailHref,
      }),
    ).toBeUndefined();
  });

  test("withholds every reference while the check is in flight", () => {
    expect(
      resolvePublicMentionHref({
        ref: { type: "maintenance", id: "m1" },
        resolvedKeys: undefined,
        buildDetailHref,
      }),
    ).toBeUndefined();
  });

  test("withholds every reference when detail linking is disabled", () => {
    // The builder preview has no public URLs to point at.
    expect(
      resolvePublicMentionHref({
        ref: { type: "maintenance", id: "m1" },
        resolvedKeys: new Set(["maintenance/m1"]),
        buildDetailHref: null,
      }),
    ).toBeUndefined();
  });

  test("withholds a surfaced reference whose type has no public page", () => {
    // Belt and braces: even if the backend ever echoed such a ref back, there
    // is no public detail page to link to.
    expect(
      resolvePublicMentionHref({
        ref: { type: "slo", id: "s1" },
        resolvedKeys: new Set(["slo/s1"]),
        buildDetailHref,
      }),
    ).toBeUndefined();
  });

  test("does not confuse the same id across two types", () => {
    const resolvedKeys = new Set(["incident/shared"]);

    expect(
      resolvePublicMentionHref({
        ref: { type: "incident", id: "shared" },
        resolvedKeys,
        buildDetailHref,
      }),
    ).toBe("/view/page/incident/shared");
    expect(
      resolvePublicMentionHref({
        ref: { type: "maintenance", id: "shared" },
        resolvedKeys,
        buildDetailHref,
      }),
    ).toBeUndefined();
  });
});

describe("publicRefKey", () => {
  test("distinguishes the same id under different types", () => {
    expect(publicRefKey({ type: "incident", id: "x" })).not.toBe(
      publicRefKey({ type: "maintenance", id: "x" }),
    );
  });
});
