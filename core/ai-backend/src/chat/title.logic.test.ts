import { describe, expect, test } from "bun:test";
import { deriveHeuristicTitle, sanitizeGeneratedTitle } from "./title.logic";

describe("deriveHeuristicTitle", () => {
  test("collapses whitespace and trims", () => {
    expect(deriveHeuristicTitle("  hello   world  ")).toBe("hello world");
  });

  test("collapses newlines/tabs into single spaces", () => {
    expect(deriveHeuristicTitle("summarize\n\tthe open incidents")).toBe(
      "summarize the open incidents",
    );
  });

  test("keeps at most six words", () => {
    expect(
      deriveHeuristicTitle("one two three four five six seven eight"),
    ).toBe("one two three four five six");
  });

  test("caps at sixty characters with no trailing-cut whitespace", () => {
    const long = "word ".repeat(40); // many words, each short
    const result = deriveHeuristicTitle(long);
    expect(result.length).toBeLessThanOrEqual(60);
    expect(result).toBe(result.trimEnd());
  });

  test("does not append an ellipsis", () => {
    const result = deriveHeuristicTitle("a".repeat(200));
    expect(result.endsWith("...")).toBe(false);
    expect(result.length).toBeLessThanOrEqual(60);
  });

  test("returns empty string for empty/whitespace input", () => {
    expect(deriveHeuristicTitle("")).toBe("");
    expect(deriveHeuristicTitle("   \n\t ")).toBe("");
  });
});

describe("sanitizeGeneratedTitle", () => {
  test("strips surrounding double quotes", () => {
    expect(sanitizeGeneratedTitle('"Open incidents summary"')).toBe(
      "Open incidents summary",
    );
  });

  test("strips surrounding single and smart quotes", () => {
    expect(sanitizeGeneratedTitle("'Health check'")).toBe("Health check");
    expect(sanitizeGeneratedTitle("“Anomaly review”")).toBe("Anomaly review");
  });

  test("strips nested/repeated wrapping quotes", () => {
    expect(sanitizeGeneratedTitle("\"'Nested title'\"")).toBe("Nested title");
  });

  test("strips leading markdown heading marker", () => {
    expect(sanitizeGeneratedTitle("## Incident triage")).toBe("Incident triage");
  });

  test("strips leading list markers", () => {
    expect(sanitizeGeneratedTitle("- Draft automation")).toBe(
      "Draft automation",
    );
    expect(sanitizeGeneratedTitle("1. Draft automation")).toBe(
      "Draft automation",
    );
  });

  test("removes bold/italic/code markers", () => {
    expect(sanitizeGeneratedTitle("**Bold** title")).toBe("Bold title");
    expect(sanitizeGeneratedTitle("`code` title")).toBe("code title");
  });

  test("drops trailing punctuation", () => {
    expect(sanitizeGeneratedTitle("Summarize incidents.")).toBe(
      "Summarize incidents",
    );
    expect(sanitizeGeneratedTitle("Is it down?!")).toBe("Is it down");
  });

  test("only keeps the first line of a multi-line reply", () => {
    expect(sanitizeGeneratedTitle("Open incidents\nmore detail here")).toBe(
      "Open incidents",
    );
  });

  test("caps to six words and sixty chars", () => {
    expect(
      sanitizeGeneratedTitle("alpha beta gamma delta epsilon zeta eta"),
    ).toBe("alpha beta gamma delta epsilon zeta");
  });

  test("returns empty string when nothing usable remains", () => {
    expect(sanitizeGeneratedTitle("")).toBe("");
    expect(sanitizeGeneratedTitle('""')).toBe("");
    expect(sanitizeGeneratedTitle("***")).toBe("");
  });
});
