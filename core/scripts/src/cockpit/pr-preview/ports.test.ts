import { describe, expect, it } from "bun:test";
import { pickFreePorts, DEFAULT_DEV_PORTS } from "./ports.ts";

describe("pickFreePorts", () => {
  it("returns the requested count of distinct ports", async () => {
    const ports = await pickFreePorts({ count: 3 });
    expect(ports).toHaveLength(3);
    expect(new Set(ports).size).toBe(3);
    for (const p of ports) {
      expect(p).toBeGreaterThan(1024);
      expect(p).toBeLessThan(65_536);
    }
  });

  it("never returns an excluded port", async () => {
    // Exclude a wide band to make an accidental hit statistically implausible,
    // plus the dev defaults.
    const exclude = [...DEFAULT_DEV_PORTS];
    const ports = await pickFreePorts({ count: 2, exclude });
    for (const p of ports) {
      expect(exclude).not.toContain(p);
    }
  });
});
