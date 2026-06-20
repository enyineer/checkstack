import { describe, it, expect } from "bun:test";
import { pluginTypeChipStyle } from "./pluginTypeChip.logic";

describe("pluginTypeChipStyle", () => {
  it("gives backend a distinct primary-tinted hue and dot", () => {
    const style = pluginTypeChipStyle("backend");
    expect(style.pill).toContain("text-primary");
    expect(style.dot).toContain("bg-primary");
  });

  it("gives frontend a distinct info-tinted hue and dot", () => {
    const style = pluginTypeChipStyle("frontend");
    expect(style.pill).toContain("text-info");
    expect(style.dot).toContain("bg-info");
  });

  it("gives common a neutral hue and dot", () => {
    const style = pluginTypeChipStyle("common");
    expect(style.pill).toContain("text-muted-foreground");
    expect(style.dot).toContain("bg-muted-foreground");
  });

  it("assigns a unique pill hue per known type", () => {
    const pills = new Set([
      pluginTypeChipStyle("backend").pill,
      pluginTypeChipStyle("frontend").pill,
      pluginTypeChipStyle("common").pill,
    ]);
    expect(pills.size).toBe(3);
  });

  it("falls back to the neutral style for unknown types", () => {
    const fallback = pluginTypeChipStyle("mystery");
    const neutral = pluginTypeChipStyle("common");
    expect(fallback).toEqual(neutral);
  });
});
