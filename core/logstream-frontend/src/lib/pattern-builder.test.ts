import { describe, expect, it } from "bun:test";
import {
  WILDCARD,
  canSavePattern,
  chipsToTemplate,
  literalTokenCount,
  templateToChips,
  toggleChip,
} from "./pattern-builder";

describe("templateToChips", () => {
  it("splits a template into literal and variable chips", () => {
    const chips = templateToChips("user <*> logged in");
    expect(chips).toEqual([
      { text: "user", isVariable: false, toggleable: true },
      { text: WILDCARD, isVariable: true, toggleable: false },
      { text: "logged", isVariable: false, toggleable: true },
      { text: "in", isVariable: false, toggleable: true },
    ]);
  });

  it("collapses surrounding and repeated whitespace", () => {
    const chips = templateToChips("  failed\tto   connect ");
    expect(chips.map((c) => c.text)).toEqual(["failed", "to", "connect"]);
  });

  it("marks an already-masked token as an inherent, non-toggleable variable", () => {
    const [chip] = templateToChips("<*>");
    expect(chip).toEqual({ text: WILDCARD, isVariable: true, toggleable: false });
  });

  it("yields no chips for an empty or whitespace-only template", () => {
    expect(templateToChips("")).toEqual([]);
    expect(templateToChips("   \t ")).toEqual([]);
  });
});

describe("chipsToTemplate", () => {
  it("renders a variable chip as the wildcard token", () => {
    const chips = templateToChips("user 42 logged in");
    const toggled = toggleChip(chips, 1);
    expect(chipsToTemplate(toggled)).toBe("user <*> logged in");
  });

  it("round-trips a masked template unchanged", () => {
    const template = "connection <*> refused on port <*>";
    expect(chipsToTemplate(templateToChips(template))).toBe(template);
  });

  it("normalizes whitespace on the round-trip", () => {
    expect(chipsToTemplate(templateToChips("a   b\tc"))).toBe("a b c");
  });
});

describe("toggleChip", () => {
  it("flips a literal to a variable and back, restoring the original token", () => {
    const chips = templateToChips("user 42 logged in");
    const toVariable = toggleChip(chips, 1);
    expect(chipsToTemplate(toVariable)).toBe("user <*> logged in");
    const backToLiteral = toggleChip(toVariable, 1);
    expect(chipsToTemplate(backToLiteral)).toBe("user 42 logged in");
  });

  it("leaves an inherent wildcard chip untouched (same identity)", () => {
    const chips = templateToChips("user <*> logged in");
    expect(toggleChip(chips, 1)).toBe(chips);
  });

  it("ignores an out-of-range index", () => {
    const chips = templateToChips("a b");
    expect(toggleChip(chips, 5)).toBe(chips);
  });
});

describe("literalTokenCount", () => {
  it("counts only the literal chips", () => {
    const chips = templateToChips("user <*> logged in <*>");
    expect(literalTokenCount(chips)).toBe(3);
  });
});

describe("canSavePattern", () => {
  it("is false with no chips", () => {
    expect(canSavePattern([])).toBe(false);
  });

  it("is false when every token is a wildcard", () => {
    const chips = templateToChips("user 42 logged");
    const allVariable = chips.map((_, i) => i).reduce(toggleChip, chips);
    expect(chipsToTemplate(allVariable)).toBe("<*> <*> <*>");
    expect(canSavePattern(allVariable)).toBe(false);
  });

  it("is true with at least one literal token", () => {
    expect(canSavePattern(templateToChips("user <*> logged in"))).toBe(true);
  });
});
