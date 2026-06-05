import { describe, expect, it } from "bun:test";
import { planKill } from "./kill-tree.ts";

describe("planKill", () => {
  it("uses taskkill with the tree flag on Windows", () => {
    const plan = planKill({ platform: "win32", pid: 1234, signal: "SIGTERM" });
    expect(plan.kind).toBe("spawn");
    if (plan.kind !== "spawn") {
      throw new Error("expected spawn plan");
    }
    expect(plan.command).toBe("taskkill");
    expect(plan.args).toEqual(["/pid", "1234", "/T", "/F"]);
  });

  it("signals the negative pid (process group) on Linux", () => {
    const plan = planKill({ platform: "linux", pid: 4321, signal: "SIGTERM" });
    expect(plan.kind).toBe("signal");
    if (plan.kind !== "signal") {
      throw new Error("expected signal plan");
    }
    expect(plan.target).toBe(-4321);
    expect(plan.signal).toBe("SIGTERM");
  });

  it("signals the negative pid on macOS", () => {
    const plan = planKill({ platform: "darwin", pid: 99, signal: "SIGKILL" });
    expect(plan.kind).toBe("signal");
    if (plan.kind !== "signal") {
      throw new Error("expected signal plan");
    }
    expect(plan.target).toBe(-99);
    expect(plan.signal).toBe("SIGKILL");
  });

  it("defaults to SIGTERM when no signal is supplied", () => {
    const plan = planKill({ platform: "linux", pid: 7 });
    if (plan.kind !== "signal") {
      throw new Error("expected signal plan");
    }
    expect(plan.signal).toBe("SIGTERM");
  });

  it("rejects a non-positive pid", () => {
    expect(() => planKill({ platform: "linux", pid: 0 })).toThrow();
    expect(() => planKill({ platform: "linux", pid: -5 })).toThrow();
  });
});
