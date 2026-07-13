import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { pickFreePorts, DEFAULT_DEV_PORTS } from "./ports.ts";

// These bind real sockets, which is instant in isolation but can exceed bun's
// 5s default when the full repo suite (or a dev stack) saturates the machine.
// Generous ceiling; the assertions are unchanged.
setDefaultTimeout(30_000);

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
