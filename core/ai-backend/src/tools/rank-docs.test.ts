import { describe, expect, test } from "bun:test";
import type { DocsIndexEntry } from "../generated/docs-index";
import {
  SNIPPET_MAX_CHARS,
  buildSnippet,
  rankDocs,
  tokenize,
} from "./rank-docs";

function entry(over: Partial<DocsIndexEntry> & { slug: string }): DocsIndexEntry {
  return {
    title: over.title ?? over.slug,
    headings: over.headings ?? [],
    content: over.content ?? "",
    truncated: over.truncated ?? false,
    ...(over.description ? { description: over.description } : {}),
    slug: over.slug,
  };
}

describe("tokenize", () => {
  test("lowercases, splits on non-alphanumerics, drops <2-char tokens", () => {
    expect(tokenize("Health-Check a HTTP 200!")).toEqual([
      "health",
      "check",
      "http",
      "200",
    ]);
  });
});

describe("buildSnippet", () => {
  test("returns the whole content when under the budget", () => {
    expect(buildSnippet({ content: "short text", queryTerms: ["text"] })).toBe(
      "short text",
    );
  });

  test("windows around the first query-term match with ellipses", () => {
    const content = "x".repeat(600) + " NEEDLE " + "y".repeat(600);
    const snippet = buildSnippet({
      content,
      queryTerms: ["needle"],
      maxChars: 100,
    });
    expect(snippet.toLowerCase()).toContain("needle");
    expect(snippet.length).toBeLessThanOrEqual(100 + 2); // + ellipses
    expect(snippet.startsWith("…")).toBe(true);
  });

  test("falls back to the head when no term occurs inline", () => {
    const content = "a".repeat(1000);
    const snippet = buildSnippet({
      content,
      queryTerms: ["zzz"],
      maxChars: 80,
    });
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(81);
  });
});

describe("rankDocs", () => {
  const index: DocsIndexEntry[] = [
    entry({
      slug: "title-hit",
      title: "Health checks",
      content: "Unrelated body about widgets.",
    }),
    entry({
      slug: "heading-hit",
      title: "Operations",
      headings: ["Configuring health checks"],
      content: "Body about operating things.",
    }),
    entry({
      slug: "content-hit",
      title: "Misc",
      content: "Somewhere in here we mention a health check probe.",
    }),
    entry({
      slug: "no-hit",
      title: "Billing",
      content: "Invoices and payments.",
    }),
  ];

  test("returns [] for an empty / whitespace-only query", () => {
    expect(rankDocs({ index, query: "", limit: 5 })).toEqual([]);
    expect(rankDocs({ index, query: "   ", limit: 5 })).toEqual([]);
  });

  test("returns [] when limit <= 0", () => {
    expect(rankDocs({ index, query: "health", limit: 0 })).toEqual([]);
  });

  test("excludes pages with no matching term", () => {
    const slugs = rankDocs({ index, query: "health check", limit: 10 }).map(
      (h) => h.slug,
    );
    expect(slugs).not.toContain("no-hit");
  });

  test("title match outranks heading match outranks content match", () => {
    const hits = rankDocs({ index, query: "health check", limit: 10 });
    const order = hits.map((h) => h.slug);
    expect(order.indexOf("title-hit")).toBeLessThan(
      order.indexOf("heading-hit"),
    );
    expect(order.indexOf("heading-hit")).toBeLessThan(
      order.indexOf("content-hit"),
    );
  });

  test("honours the limit cap", () => {
    const hits = rankDocs({ index, query: "health check", limit: 2 });
    expect(hits.length).toBe(2);
  });

  test("attaches the matching heading when the hit is a sub-section", () => {
    const hit = rankDocs({ index, query: "configuring", limit: 5 }).find(
      (h) => h.slug === "heading-hit",
    );
    expect(hit?.heading).toBe("Configuring health checks");
  });

  test("snippets never exceed the budget", () => {
    const big = entry({
      slug: "big",
      title: "Big",
      content: ("health check ".repeat(500)).trim(),
    });
    const hit = rankDocs({ index: [big], query: "health", limit: 1 })[0];
    expect(hit?.snippet.length).toBeLessThanOrEqual(SNIPPET_MAX_CHARS + 2);
  });

  test("ordering is stable / deterministic across runs", () => {
    const a = rankDocs({ index, query: "health check", limit: 10 });
    const b = rankDocs({ index, query: "health check", limit: 10 });
    expect(a.map((h) => h.slug)).toEqual(b.map((h) => h.slug));
  });

  test("ties break by slug (deterministic ordering)", () => {
    const tied: DocsIndexEntry[] = [
      entry({ slug: "zebra", title: "Foo", content: "foo" }),
      entry({ slug: "alpha", title: "Foo", content: "foo" }),
    ];
    const order = rankDocs({ index: tied, query: "foo", limit: 5 }).map(
      (h) => h.slug,
    );
    expect(order).toEqual(["alpha", "zebra"]);
  });
});
