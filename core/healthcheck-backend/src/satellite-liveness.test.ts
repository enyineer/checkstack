import { describe, expect, test } from "bun:test";
import {
  buildUnobservableResult,
  buildUnobservableRun,
  resolveSatelliteOnlyOutcome,
} from "./satellite-liveness";

describe("resolveSatelliteOnlyOutcome", () => {
  test("satellites execute the check when any assigned one is online", () => {
    expect(
      resolveSatelliteOnlyOutcome({
        satelliteIds: ["a", "b"],
        onlineSatelliteIds: ["b"],
      }),
    ).toBe("satellites-executing");
  });

  test("records an unobservable run when NO assigned satellite is online", () => {
    // The bug: this used to return silently, so the check kept displaying its
    // last status forever and a dead probe read exactly like a passing one.
    expect(
      resolveSatelliteOnlyOutcome({
        satelliteIds: ["a", "b"],
        onlineSatelliteIds: [],
      }),
    ).toBe("record-unobservable");
  });

  test("ignores online satellites this check is not assigned to", () => {
    expect(
      resolveSatelliteOnlyOutcome({
        satelliteIds: ["a"],
        onlineSatelliteIds: ["someone-else"],
      }),
    ).toBe("record-unobservable");
  });

  test("stays silent when liveness is UNKNOWN", () => {
    // A transient failure to reach the satellite service must never mark every
    // satellite-only check in the fleet degraded at once. Unknown is not the
    // same as offline, and silence is the pre-existing, safe direction.
    expect(
      resolveSatelliteOnlyOutcome({ satelliteIds: ["a"] }),
    ).toBe("satellites-executing");
  });

  test("a check with no assigned satellites is treated as executing", () => {
    // Not reachable from the caller (the branch requires assignments), but the
    // function must not claim an empty assignment set is unobservable.
    expect(
      resolveSatelliteOnlyOutcome({
        satelliteIds: [],
        onlineSatelliteIds: [],
      }),
    ).toBe("satellites-executing");
  });

  test("one online satellite out of many is enough", () => {
    expect(
      resolveSatelliteOnlyOutcome({
        satelliteIds: ["a", "b", "c"],
        onlineSatelliteIds: ["c"],
      }),
    ).toBe("satellites-executing");
  });
});

describe("buildUnobservableResult", () => {
  test("says plainly that health is UNKNOWN, not that the target is down", () => {
    // The run is degraded because we could not observe, not because the service
    // failed. The message must not let an operator conclude otherwise.
    const result = buildUnobservableResult({ satelliteIds: ["a", "b"] });

    expect(String(result.error)).toContain("unknown");
    expect(String(result.error)).toContain("monitoring gap");
    expect(String(result.error)).toContain("not a confirmed outage");
  });

  test("carries a machine-readable marker and the assignment count", () => {
    const result = buildUnobservableResult({ satelliteIds: ["a", "b"] });

    expect(result.satelliteOffline).toBe(true);
    expect(result.assignedSatelliteCount).toBe(2);
  });
});

describe("buildUnobservableRun", () => {
  test("records DEGRADED, never unhealthy", () => {
    // Unhealthy would raise incident-grade alarms about services that may be
    // perfectly healthy, every time a satellite host reboots.
    expect(
      buildUnobservableRun({ environmentId: null, satelliteIds: ["a"] }).status,
    ).toBe("degraded");
  });

  test("lands on the slice the job owns, including a concrete environment", () => {
    // The satellites would have reported for this exact slice, so the gap has
    // to be recorded there and not on the rollup.
    expect(
      buildUnobservableRun({ environmentId: "env-1", satelliteIds: ["a"] })
        .environmentId,
    ).toBe("env-1");
    expect(
      buildUnobservableRun({ environmentId: null, satelliteIds: ["a"] })
        .environmentId,
    ).toBeNull();
  });

  test("attributes the run to the core, not to a satellite", () => {
    // A satellite reported nothing - the core is what noticed the gap.
    expect(
      buildUnobservableRun({ environmentId: null, satelliteIds: ["a"] })
        .sourceLabel,
    ).toBe("Local");
  });

  test("carries the explanatory result payload", () => {
    const run = buildUnobservableRun({
      environmentId: null,
      satelliteIds: ["a", "b"],
    });

    expect(run.result.satelliteOffline).toBe(true);
    expect(run.result.assignedSatelliteCount).toBe(2);
    expect(String(run.result.error)).toContain("unknown");
  });
});

describe("resolveSatelliteOnlyOutcome - assignment changes must not fabricate a gap", () => {
  /**
   * The class of bug these guard: an operator changes an assignment and the
   * platform reacts as though something FAILED. Removing a satellite, adding
   * local execution back, or swapping one satellite for another are all
   * deliberate acts - none of them means "nobody is checking this".
   */
  test("emptying the satellite list is not an outage", () => {
    // The executor's branch requires a non-empty list, but the predicate must
    // agree independently - a future caller must not be able to turn a cleared
    // assignment into a degraded run.
    expect(
      resolveSatelliteOnlyOutcome({
        satelliteIds: [],
        onlineSatelliteIds: [],
      }),
    ).toBe("satellites-executing");
  });

  test("swapping to a different, online satellite is not an outage", () => {
    expect(
      resolveSatelliteOnlyOutcome({
        satelliteIds: ["new-sat"],
        onlineSatelliteIds: ["new-sat"],
      }),
    ).toBe("satellites-executing");
  });

  test("one online satellite is enough even when the others were deleted", () => {
    // A deleted satellite simply stops appearing in the online set. As long as
    // ONE assigned satellite is still online, the check is being executed.
    expect(
      resolveSatelliteOnlyOutcome({
        satelliteIds: ["deleted-sat", "live-sat"],
        onlineSatelliteIds: ["live-sat", "unrelated-sat"],
      }),
    ).toBe("satellites-executing");
  });

  test("an entirely unrelated fleet being online is NOT enough", () => {
    // Guards the inverse mistake: "some satellite somewhere is up" must not be
    // read as "this check is being executed".
    expect(
      resolveSatelliteOnlyOutcome({
        satelliteIds: ["mine"],
        onlineSatelliteIds: ["someone-elses", "another"],
      }),
    ).toBe("record-unobservable");
  });

  test("an empty online set with no assignment is not an outage", () => {
    expect(
      resolveSatelliteOnlyOutcome({ satelliteIds: [], onlineSatelliteIds: [] }),
    ).toBe("satellites-executing");
  });

  test("duplicate ids in an assignment do not change the verdict", () => {
    expect(
      resolveSatelliteOnlyOutcome({
        satelliteIds: ["a", "a"],
        onlineSatelliteIds: ["a"],
      }),
    ).toBe("satellites-executing");
    expect(
      resolveSatelliteOnlyOutcome({
        satelliteIds: ["a", "a"],
        onlineSatelliteIds: [],
      }),
    ).toBe("record-unobservable");
  });
});
