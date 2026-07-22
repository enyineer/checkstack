import { describe, it, expect } from "bun:test";

import {
  deriveHealthcheckSignals,
  HEALTHCHECK_SIGNAL_SOURCE_ID,
  type HealthcheckSignalStatuses,
} from "./system-signals";
import type { HealthCheckStatus } from "./schemas";
import { healthCheckAccess } from "./access";

/**
 * Build a check status. By default a check is a SINGLE slice (env-less or
 * single-env, run from the core only), so `sliceCount` is 1 and it fails as a
 * whole — matching the non-fanned behavior. Fan-out cases pass
 * `sliceCount`/`failingSliceCount` explicitly to model a check spanning several
 * environments or probed from several sources.
 *
 * `slices` stays empty: signal derivation reads only the counts, so the
 * breakdown these tests would have to invent adds nothing to what they assert.
 */
const mkCheck = ({
  configurationId,
  status,
  sliceCount = 1,
  failingSliceCount = status === "healthy" ? 0 : 1,
}: {
  configurationId: string;
  status: HealthCheckStatus;
  sliceCount?: number;
  failingSliceCount?: number;
}) => ({
  configurationId,
  configurationName: "Ping",
  runsConsidered: 5,
  status,
  sliceCount,
  failingSliceCount,
  slices: [],
});

describe("deriveHealthcheckSignals", () => {
  it("returns no signals for an empty status map", () => {
    expect(deriveHealthcheckSignals({ statuses: {} })).toEqual({});
  });

  it("omits healthy systems", () => {
    const statuses: HealthcheckSignalStatuses = {
      s1: {
        status: "healthy",
        evaluatedAt: new Date(),
        checkStatuses: [
          mkCheck({ configurationId: "c1", status: "healthy" }),
        ],
      },
    };
    expect(deriveHealthcheckSignals({ statuses })).toEqual({});
  });

  it("emits an error-tone Unhealthy signal linking to the failing check history", () => {
    const statuses: HealthcheckSignalStatuses = {
      s1: {
        status: "unhealthy",
        evaluatedAt: new Date(),
        checkStatuses: [
          mkCheck({ configurationId: "c1", status: "unhealthy" }),
          mkCheck({ configurationId: "c2", status: "healthy" }),
        ],
      },
    };

    const result = deriveHealthcheckSignals({ statuses });

    expect(result).toEqual({
      s1: [
        {
          source: HEALTHCHECK_SIGNAL_SOURCE_ID,
          tone: "error",
          label: "Unhealthy",
          detail: "1 of 2 checks failing",
          href: "/healthcheck/history/s1/c1",
          accessRule: healthCheckAccess.configuration.manage,
          iconName: "Activity",
        },
      ],
    });
  });

  it("emits a warn-tone Degraded signal", () => {
    const statuses: HealthcheckSignalStatuses = {
      s2: {
        status: "degraded",
        evaluatedAt: new Date(),
        checkStatuses: [
          mkCheck({ configurationId: "c9", status: "degraded" }),
        ],
      },
    };

    const result = deriveHealthcheckSignals({ statuses });

    expect(result.s2).toHaveLength(1);
    expect(result.s2[0].tone).toBe("warn");
    expect(result.s2[0].label).toBe("Degraded");
    expect(result.s2[0].detail).toBe("1 of 1 checks failing");
    expect(result.s2[0].href).toBe("/healthcheck/history/s2/c9");
  });

  it("attributes an incident-forced status to the incident, not to failing checks", () => {
    // The bulk RPC folds an active incident override into `status`, so a system
    // can be unhealthy with every check green. The signal must say so honestly
    // (no "0 of N checks failing") and link nowhere (the incident's own signal
    // carries the link).
    const statuses: HealthcheckSignalStatuses = {
      s3: {
        status: "unhealthy",
        evaluatedAt: new Date(),
        checkStatuses: [
          mkCheck({ configurationId: "c1", status: "healthy" }),
          mkCheck({ configurationId: "c2", status: "healthy" }),
        ],
        override: {
          status: "unhealthy",
          source: "incident",
          reason: "License server revoked",
          sourceId: "inc-1",
        },
      },
    };

    const result = deriveHealthcheckSignals({ statuses });

    expect(result.s3).toHaveLength(1);
    expect(result.s3[0].label).toBe("Unhealthy");
    expect(result.s3[0].tone).toBe("error");
    expect(result.s3[0].detail).toBe("Forced by incident: License server revoked");
    expect(result.s3[0].href).toBeUndefined();
    expect(result.s3[0].accessRule).toBeUndefined();
  });

  it("still reports the failing-check count when checks fail AND an incident overrides", () => {
    const statuses: HealthcheckSignalStatuses = {
      s4: {
        status: "unhealthy",
        evaluatedAt: new Date(),
        checkStatuses: [
          mkCheck({ configurationId: "c1", status: "degraded" }),
          mkCheck({ configurationId: "c2", status: "healthy" }),
        ],
        override: {
          status: "unhealthy",
          source: "incident",
          reason: "Vendor outage",
          sourceId: "inc-2",
        },
      },
    };

    const result = deriveHealthcheckSignals({ statuses });

    // Overall status (unhealthy, from the override) drives the label; the detail
    // still surfaces the genuinely failing check rather than the incident.
    expect(result.s4[0].label).toBe("Unhealthy");
    expect(result.s4[0].detail).toBe("1 of 2 checks failing");
    expect(result.s4[0].href).toBe("/healthcheck/history/s4/c1");
  });

  it("when a check is WORSE than the override, the check drives the signal", () => {
    // Override forces only `degraded`, but a check is `unhealthy`. Worst-wins in
    // the fold makes the overall status unhealthy, so the signal reads Unhealthy
    // and attributes it to the failing check (not the incident): the incident's
    // milder override never masks a genuinely worse check.
    const statuses: HealthcheckSignalStatuses = {
      s5: {
        status: "unhealthy",
        evaluatedAt: new Date(),
        checkStatuses: [
          mkCheck({ configurationId: "c1", status: "unhealthy" }),
          mkCheck({ configurationId: "c2", status: "healthy" }),
        ],
        override: {
          status: "degraded",
          source: "incident",
          reason: "Cosmetic incident",
          sourceId: "inc-9",
        },
      },
    };

    const result = deriveHealthcheckSignals({ statuses });

    expect(result.s5[0].label).toBe("Unhealthy");
    expect(result.s5[0].tone).toBe("error");
    expect(result.s5[0].detail).toBe("1 of 2 checks failing");
    expect(result.s5[0].href).toBe("/healthcheck/history/s5/c1");
  });

  it("counts fanned-out environment slices, not checks (1 check / 3 envs, 1 failing)", () => {
    // A single check fanning out to three environments with one env failing is
    // "1 of 3", NOT "1 of 1". The check's rollup status is degraded/unhealthy
    // but its denominator must reflect the environment fan-out.
    const statuses: HealthcheckSignalStatuses = {
      s1: {
        status: "unhealthy",
        evaluatedAt: new Date(),
        checkStatuses: [
          mkCheck({
            configurationId: "c1",
            status: "unhealthy",
            sliceCount: 3,
            failingSliceCount: 1,
          }),
        ],
      },
    };

    const result = deriveHealthcheckSignals({ statuses });

    expect(result.s1[0].detail).toBe("1 of 3 checks failing");
    expect(result.s1[0].href).toBe("/healthcheck/history/s1/c1");
  });

  it("sums slices across checks (one 3-env check + one 1-env check, 1 failing = 1 of 4)", () => {
    const statuses: HealthcheckSignalStatuses = {
      s1: {
        status: "unhealthy",
        evaluatedAt: new Date(),
        checkStatuses: [
          mkCheck({
            configurationId: "c1",
            status: "unhealthy",
            sliceCount: 3,
            failingSliceCount: 1,
          }),
          mkCheck({ configurationId: "c2", status: "healthy" }), // 1 env, ok
        ],
      },
    };

    const result = deriveHealthcheckSignals({ statuses });

    expect(result.s1[0].detail).toBe("1 of 4 checks failing");
  });

  it("counts multiple failing environments within one fanned-out check (2 of 3)", () => {
    const statuses: HealthcheckSignalStatuses = {
      s1: {
        status: "unhealthy",
        evaluatedAt: new Date(),
        checkStatuses: [
          mkCheck({
            configurationId: "c1",
            status: "unhealthy",
            sliceCount: 3,
            failingSliceCount: 2,
          }),
        ],
      },
    };

    const result = deriveHealthcheckSignals({ statuses });

    expect(result.s1[0].detail).toBe("2 of 3 checks failing");
  });

  it("only includes problem systems when mixed with healthy ones", () => {
    const statuses: HealthcheckSignalStatuses = {
      healthy1: {
        status: "healthy",
        evaluatedAt: new Date(),
        checkStatuses: [
          mkCheck({ configurationId: "c1", status: "healthy" }),
        ],
      },
      bad1: {
        status: "degraded",
        evaluatedAt: new Date(),
        checkStatuses: [
          mkCheck({ configurationId: "c2", status: "degraded" }),
        ],
      },
    };

    const result = deriveHealthcheckSignals({ statuses });

    expect(Object.keys(result)).toEqual(["bad1"]);
  });
});
