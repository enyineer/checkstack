import { describe, expect, it } from "bun:test";
import type { AuditAdvisory, AuditSeverity } from "@checkstack/script-packages-common";
import { advisoryKey, computeAuditDelta } from "./audit-delta";

function adv(
  packageName: string,
  advisoryId: string,
  severity: AuditSeverity,
): AuditAdvisory {
  return {
    packageName,
    advisoryId,
    severity,
    title: `${packageName} ${advisoryId}`,
    vulnerableVersions: "<1",
    url: null,
    cvssScore: null,
  };
}

const THRESHOLD: AuditSeverity = "moderate";

describe("computeAuditDelta", () => {
  it("notifies newly-appeared advisories at or above the threshold", () => {
    const result = computeAuditDelta({
      previous: [],
      current: [adv("lodash", "1", "high"), adv("a", "2", "low")],
      threshold: THRESHOLD,
    });
    expect(result.toNotify.map((a) => a.packageName)).toEqual(["lodash"]);
    expect(result.newlyAppeared.sort()).toEqual([
      advisoryKey({ packageName: "a", advisoryId: "2" }),
      advisoryKey({ packageName: "lodash", advisoryId: "1" }),
    ]);
  });

  it("does NOT notify a newly-appeared advisory below the threshold", () => {
    const result = computeAuditDelta({
      previous: [],
      current: [adv("a", "1", "low")],
      threshold: THRESHOLD,
    });
    expect(result.toNotify).toEqual([]);
    expect(result.newlyAppeared).toHaveLength(1);
  });

  it("suppresses re-notify on an unchanged set (the spam guard)", () => {
    const set = [adv("lodash", "1", "high"), adv("zod", "2", "critical")];
    const result = computeAuditDelta({
      previous: set,
      current: set,
      threshold: THRESHOLD,
    });
    expect(result.toNotify).toEqual([]);
    expect(result.newlyAppeared).toEqual([]);
    expect(result.escalated).toEqual([]);
  });

  it("notifies on severity escalation across the threshold", () => {
    const result = computeAuditDelta({
      previous: [adv("lodash", "1", "low")],
      current: [adv("lodash", "1", "high")],
      threshold: THRESHOLD,
    });
    expect(result.toNotify.map((a) => a.packageName)).toEqual(["lodash"]);
    expect(result.escalated).toEqual([
      advisoryKey({ packageName: "lodash", advisoryId: "1" }),
    ]);
  });

  it("notifies on a within-threshold escalation (high -> critical)", () => {
    const result = computeAuditDelta({
      previous: [adv("lodash", "1", "high")],
      current: [adv("lodash", "1", "critical")],
      threshold: THRESHOLD,
    });
    expect(result.toNotify).toHaveLength(1);
    expect(result.escalated).toHaveLength(1);
  });

  it("does not notify a below-threshold escalation (low -> moderate is at threshold; low->low-ish stays quiet)", () => {
    // escalated but still below threshold: bump low -> ... still below.
    const result = computeAuditDelta({
      previous: [adv("a", "1", "low")],
      current: [adv("a", "1", "low")], // unchanged
      threshold: "high",
    });
    expect(result.toNotify).toEqual([]);
    expect(result.escalated).toEqual([]);
  });

  it("never notifies on de-escalation", () => {
    const result = computeAuditDelta({
      previous: [adv("lodash", "1", "critical")],
      current: [adv("lodash", "1", "moderate")],
      threshold: THRESHOLD,
    });
    expect(result.toNotify).toEqual([]);
    expect(result.escalated).toEqual([]);
  });

  it("does not notify when an advisory disappears", () => {
    const result = computeAuditDelta({
      previous: [adv("lodash", "1", "high")],
      current: [],
      threshold: THRESHOLD,
    });
    expect(result.toNotify).toEqual([]);
    expect(result.newlyAppeared).toEqual([]);
  });

  it("sorts toNotify by severity (most severe first) then package name", () => {
    const result = computeAuditDelta({
      previous: [],
      current: [
        adv("b", "1", "moderate"),
        adv("a", "2", "critical"),
        adv("c", "3", "high"),
        adv("a", "4", "moderate"),
      ],
      threshold: THRESHOLD,
    });
    expect(
      result.toNotify.map((a) => `${a.severity}:${a.packageName}`),
    ).toEqual(["critical:a", "high:c", "moderate:a", "moderate:b"]);
  });
});
