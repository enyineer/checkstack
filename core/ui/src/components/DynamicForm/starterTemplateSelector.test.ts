import { describe, expect, it } from "bun:test";
import { pickStarterForEmptyField } from "./starterTemplateSelector";
import type { EditorStarterTemplates } from "./types";

/**
 * Regression suite for the starter-template seeding behaviour in
 * `MultiTypeEditorField`.
 *
 * The previous implementation gated seeding behind an `isInitialMount`
 * ref that a sibling effect with `[value]` deps flipped to false BEFORE
 * the seed effect ran — so seeding silently no-op'd on every mount and
 * users always saw a blank canvas. The refactored seed effect delegates
 * to this pure function; testing it here proves the decision is correct
 * regardless of the React effect ordering trap.
 */

const STARTERS: EditorStarterTemplates = {
  typescript: "// starter for TypeScript",
  shell: "#!/bin/sh\necho starter for shell",
};

describe("pickStarterForEmptyField", () => {
  it("returns the starter for the selected language when the field is empty", () => {
    expect(
      pickStarterForEmptyField({
        value: "",
        selectedType: "typescript",
        starterTemplates: STARTERS,
      }),
    ).toBe(STARTERS.typescript);
  });

  it("returns the starter when the value is whitespace-only", () => {
    // The original bug let trailing whitespace block the seed; explicit
    // coverage so we don't regress.
    expect(
      pickStarterForEmptyField({
        value: "   \n\t  ",
        selectedType: "typescript",
        starterTemplates: STARTERS,
      }),
    ).toBe(STARTERS.typescript);
  });

  it("returns undefined when the field already has content (don't clobber)", () => {
    expect(
      pickStarterForEmptyField({
        value: "// user's existing code",
        selectedType: "typescript",
        starterTemplates: STARTERS,
      }),
    ).toBeUndefined();
  });

  it("returns undefined when value is undefined and no starter is defined for the selected language", () => {
    expect(
      pickStarterForEmptyField({
        value: undefined,
        selectedType: "json",
        starterTemplates: STARTERS,
      }),
    ).toBeUndefined();
  });

  it("returns undefined when no `starterTemplates` are provided at all", () => {
    expect(
      pickStarterForEmptyField({
        value: "",
        selectedType: "typescript",
      }),
    ).toBeUndefined();
  });

  it("returns the shell starter when shell is selected", () => {
    expect(
      pickStarterForEmptyField({
        value: undefined,
        selectedType: "shell",
        starterTemplates: STARTERS,
      }),
    ).toBe(STARTERS.shell);
  });

  it("treats an empty-string starter as 'no starter available'", () => {
    // We never want to install a literal empty string on top of an
    // already-empty field; that would just look like the seed silently
    // did nothing.
    expect(
      pickStarterForEmptyField({
        value: "",
        selectedType: "typescript",
        starterTemplates: { typescript: "" },
      }),
    ).toBeUndefined();
  });
});
