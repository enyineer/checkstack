import { describe, expect, it } from "bun:test";
import { countToneStyles, hasRetried } from "./jobDisplay.logic";

describe("countToneStyles", () => {
  it("keeps the default tone neutral with no status colors", () => {
    const { pill, dot, accent, icon } = countToneStyles.default;
    expect(pill).not.toContain("status-");
    expect(dot).not.toContain("status-");
    expect(accent).not.toContain("status-");
    expect(icon).not.toContain("status-");
  });

  it("drives status tones from the colorblind-safe triad", () => {
    expect(countToneStyles.warning.accent).toBe("bg-status-warn");
    expect(countToneStyles.success.accent).toBe("bg-status-ok");
    expect(countToneStyles.danger.accent).toBe("bg-status-down");
  });

  it("pairs each status tone's pill and dot to the same hue", () => {
    expect(countToneStyles.warning.pill).toContain("status-warn");
    expect(countToneStyles.warning.dot).toBe("bg-status-warn");
    expect(countToneStyles.success.pill).toContain("status-ok");
    expect(countToneStyles.danger.pill).toContain("status-down");
  });
});

describe("hasRetried", () => {
  it("is false for the first attempt", () => {
    expect(hasRetried(0)).toBe(false);
    expect(hasRetried(1)).toBe(false);
  });

  it("is true once a job has retried", () => {
    expect(hasRetried(2)).toBe(true);
    expect(hasRetried(5)).toBe(true);
  });
});
