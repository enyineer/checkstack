import { describe, expect, it } from "bun:test";
import {
  auditPostureTone,
  installStatusTone,
  satelliteStatusTone,
  severityTone,
} from "./status-display";

describe("installStatusTone", () => {
  it("maps known install statuses to triad tones", () => {
    expect(installStatusTone("ready")).toBe("ok");
    expect(installStatusTone("installing")).toBe("warn");
    expect(installStatusTone("error")).toBe("down");
    expect(installStatusTone("idle")).toBe("unknown");
  });

  it("falls back to unknown for undefined or unrecognized values", () => {
    expect(installStatusTone(undefined)).toBe("unknown");
    expect(installStatusTone("bogus")).toBe("unknown");
  });
});

describe("satelliteStatusTone", () => {
  it("maps known satellite sync statuses to triad tones", () => {
    expect(satelliteStatusTone("ready")).toBe("ok");
    expect(satelliteStatusTone("syncing")).toBe("warn");
    expect(satelliteStatusTone("pending")).toBe("warn");
    expect(satelliteStatusTone("error")).toBe("down");
  });

  it("falls back to unknown for unrecognized values", () => {
    expect(satelliteStatusTone("bogus")).toBe("unknown");
  });
});

describe("severityTone", () => {
  it("maps advisory severities to triad tones", () => {
    expect(severityTone("critical")).toBe("down");
    expect(severityTone("high")).toBe("down");
    expect(severityTone("moderate")).toBe("warn");
    expect(severityTone("low")).toBe("ok");
  });
});

describe("auditPostureTone", () => {
  it("is ok when there are no open advisories", () => {
    expect(auditPostureTone({ total: 0 })).toBe("ok");
    expect(
      auditPostureTone({
        total: 0,
        counts: { critical: 0, high: 0, moderate: 0, low: 0 },
      }),
    ).toBe("ok");
  });

  it("is down when any critical or high advisory is present", () => {
    expect(
      auditPostureTone({
        total: 1,
        counts: { critical: 1, high: 0, moderate: 0, low: 0 },
      }),
    ).toBe("down");
    expect(
      auditPostureTone({
        total: 2,
        counts: { critical: 0, high: 2, moderate: 0, low: 0 },
      }),
    ).toBe("down");
  });

  it("is warn when only moderate or low advisories remain", () => {
    expect(
      auditPostureTone({
        total: 3,
        counts: { critical: 0, high: 0, moderate: 1, low: 2 },
      }),
    ).toBe("warn");
    expect(
      auditPostureTone({
        total: 1,
        counts: { critical: 0, high: 0, moderate: 0, low: 1 },
      }),
    ).toBe("warn");
  });

  it("falls back to down when advisories exist without a breakdown", () => {
    expect(auditPostureTone({ total: 5 })).toBe("down");
  });
});
