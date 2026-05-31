import { describe, expect, it } from "bun:test";
import { popoutTitle } from "./popoutTitle";
import type { CodeEditorLanguage } from "./types";

describe("popoutTitle", () => {
  it("derives a script title for TypeScript", () => {
    expect(popoutTitle({ language: "typescript" })).toBe(
      "Edit script - TypeScript",
    );
  });

  it("derives a script title for JavaScript", () => {
    expect(popoutTitle({ language: "javascript" })).toBe(
      "Edit script - JavaScript",
    );
  });

  it("derives a script title for Shell", () => {
    expect(popoutTitle({ language: "shell" })).toBe("Edit script - Shell");
  });

  it("falls back to a generic title for markup/text languages", () => {
    const markupLanguages: CodeEditorLanguage[] = [
      "json",
      "yaml",
      "xml",
      "markdown",
    ];
    for (const language of markupLanguages) {
      expect(popoutTitle({ language })).toBe("Edit");
    }
  });

  it("uses a normal hyphen, never an em-dash", () => {
    expect(popoutTitle({ language: "typescript" })).not.toContain("—");
  });
});
