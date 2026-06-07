import { describe, it, expect } from "bun:test";

import {
  deriveHealthcheckSignals,
  HEALTHCHECK_SIGNAL_SOURCE_ID,
  type HealthcheckSignalStatuses,
} from "./system-signals";
import { healthCheckAccess } from "./access";

const baseCheck = {
  configurationName: "Ping",
  runsConsidered: 5,
};

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
          { ...baseCheck, configurationId: "c1", status: "healthy" },
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
          { ...baseCheck, configurationId: "c1", status: "unhealthy" },
          { ...baseCheck, configurationId: "c2", status: "healthy" },
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
          accessRule: healthCheckAccess.details,
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
          { ...baseCheck, configurationId: "c9", status: "degraded" },
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

  it("links to the assignments page (manage rule) when no specific check is failing", () => {
    const statuses: HealthcheckSignalStatuses = {
      s3: {
        status: "unhealthy",
        evaluatedAt: new Date(),
        // Non-healthy aggregate with zero check rows: no failing check to link.
        checkStatuses: [],
      },
    };

    const result = deriveHealthcheckSignals({ statuses });

    expect(result.s3[0].href).toBe("/healthcheck/assignments/s3");
    expect(result.s3[0].accessRule).toBe(healthCheckAccess.configuration.manage);
    expect(result.s3[0].detail).toBeUndefined();
  });

  it("only includes problem systems when mixed with healthy ones", () => {
    const statuses: HealthcheckSignalStatuses = {
      healthy1: {
        status: "healthy",
        evaluatedAt: new Date(),
        checkStatuses: [
          { ...baseCheck, configurationId: "c1", status: "healthy" },
        ],
      },
      bad1: {
        status: "degraded",
        evaluatedAt: new Date(),
        checkStatuses: [
          { ...baseCheck, configurationId: "c2", status: "degraded" },
        ],
      },
    };

    const result = deriveHealthcheckSignals({ statuses });

    expect(Object.keys(result)).toEqual(["bad1"]);
  });
});
