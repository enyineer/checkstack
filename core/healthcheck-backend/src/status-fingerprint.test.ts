import { describe, it, expect } from "bun:test";
import {
  statusFingerprint,
  statusVectorChanged,
  type StatusFingerprintInput,
} from "./status-fingerprint";

const check = (
  configurationId: string,
  status: string,
  sliceCount = 1,
  failingSliceCount = 0,
): StatusFingerprintInput["checkStatuses"][number] => ({
  configurationId,
  status,
  sliceCount,
  failingSliceCount,
});

describe("statusFingerprint", () => {
  it("is invariant to check ORDER", () => {
    const a: StatusFingerprintInput = {
      status: "degraded",
      checkStatuses: [check("c1", "healthy"), check("c2", "degraded")],
    };
    const b: StatusFingerprintInput = {
      status: "degraded",
      checkStatuses: [check("c2", "degraded"), check("c1", "healthy")],
    };
    expect(statusFingerprint(a)).toBe(statusFingerprint(b));
  });

  it("differs when a check's status flips", () => {
    const before = statusFingerprint({
      status: "healthy",
      checkStatuses: [check("c1", "healthy")],
    });
    const after = statusFingerprint({
      status: "healthy",
      checkStatuses: [check("c1", "degraded")],
    });
    expect(before).not.toBe(after);
  });

  it("differs when only the slice failure count changes", () => {
    const before = statusFingerprint({
      status: "degraded",
      checkStatuses: [check("c1", "degraded", 3, 1)],
    });
    const after = statusFingerprint({
      status: "degraded",
      checkStatuses: [check("c1", "degraded", 3, 2)],
    });
    expect(before).not.toBe(after);
  });
});

describe("statusVectorChanged", () => {
  const base: StatusFingerprintInput = {
    status: "healthy",
    checkStatuses: [check("c1", "healthy"), check("c2", "healthy")],
  };

  it("is FALSE for a pure timestamp/runs refresh (same vector)", () => {
    // Volatile fields (evaluatedAt / lastRunAt / runsConsidered) are not part of
    // the fingerprint, so an object carrying different ones but the same vector
    // is not a change. Represented here by an identical vector.
    const next: StatusFingerprintInput = {
      status: "healthy",
      checkStatuses: [check("c1", "healthy"), check("c2", "healthy")],
    };
    expect(statusVectorChanged(base, next)).toBe(false);
  });

  it("is TRUE for a per-check flip even when the rollup enum is unchanged", () => {
    // Rollup stays "healthy" here (contrived), but c2 flipped — the entity view
    // {status, healthyChecks, totalChecks} could miss this, the fingerprint does not.
    const next: StatusFingerprintInput = {
      status: "healthy",
      checkStatuses: [check("c1", "healthy"), check("c2", "degraded")],
    };
    expect(statusVectorChanged(base, next)).toBe(true);
  });

  it("is TRUE when the check SET changes", () => {
    const next: StatusFingerprintInput = {
      status: "healthy",
      checkStatuses: [check("c1", "healthy")],
    };
    expect(statusVectorChanged(base, next)).toBe(true);
  });
});
