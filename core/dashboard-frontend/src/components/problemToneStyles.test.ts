import { describe, expect, it } from "bun:test";
import type { SystemSignalTone } from "@checkstack/catalog-common";
import {
  problemToneStyles,
  resolveProblemToneStyle,
  signalCountCaption,
} from "./problemToneStyles";

describe("resolveProblemToneStyle", () => {
  it("maps each signal tone onto the colorblind-safe status triad", () => {
    expect(resolveProblemToneStyle("error").accent).toBe("bg-status-down");
    expect(resolveProblemToneStyle("warn").accent).toBe("bg-status-warn");
    // The status ladder's blue, NOT the general-purpose `--info` accent this
    // once used: all three signal tones are rungs of the same ladder, and the
    // ladder's blue is the darker one chosen to stay readable on a light card.
    expect(resolveProblemToneStyle("info").accent).toBe("bg-status-info");
  });

  it("keeps pill and dot hues consistent within a tone", () => {
    const tones: SystemSignalTone[] = ["error", "warn", "info"];
    for (const tone of tones) {
      const style = resolveProblemToneStyle(tone);
      // dot color matches the accent stripe color for the same tone
      expect(style.dot).toBe(style.accent);
      // pill carries both a tinted background and a text color
      expect(style.pill).toContain("/10");
      expect(style.pill).toContain("text-");
    }
  });

  it("exposes a label for every tone", () => {
    expect(problemToneStyles.error.label).toBe("Critical");
    expect(problemToneStyles.warn.label).toBe("Degraded");
    expect(problemToneStyles.info.label).toBe("Watch");
  });
});

describe("signalCountCaption", () => {
  it("uses the singular form for exactly one signal", () => {
    expect(signalCountCaption(1)).toBe("signal");
  });

  it("uses the plural form for zero or many signals", () => {
    expect(signalCountCaption(0)).toBe("signals");
    expect(signalCountCaption(2)).toBe("signals");
    expect(signalCountCaption(42)).toBe("signals");
  });
});
