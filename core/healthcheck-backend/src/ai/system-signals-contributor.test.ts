import { describe, it, expect } from "bun:test";
import {
  HEALTHCHECK_SIGNAL_SOURCE_ID,
  type HealthcheckSignalStatuses,
} from "@checkstack/healthcheck-common";
import type { AuthUser } from "@checkstack/backend-api";

import {
  createHealthcheckSignalsContributor,
  type HealthcheckSignalsSource,
} from "./system-signals-contributor";

const unhealthyStatuses: HealthcheckSignalStatuses = {
  s1: {
    status: "unhealthy",
    evaluatedAt: new Date(),
    checkStatuses: [
      {
        configurationId: "c1",
        configurationName: "Ping",
        status: "unhealthy",
        runsConsidered: 5,
      },
    ],
  },
};

function sourceReturning(
  statuses: HealthcheckSignalStatuses,
): { source: HealthcheckSignalsSource; calls: () => number } {
  let count = 0;
  return {
    calls: () => count,
    source: {
      getAllUnhealthySystemStatuses: async () => {
        count += 1;
        return statuses;
      },
    },
  };
}

const userWith = (accessRules: string[]): AuthUser => ({
  type: "user",
  id: "u1",
  accessRules,
});

describe("createHealthcheckSignalsContributor", () => {
  it("exposes the shared source id", () => {
    const { source } = sourceReturning({});
    const contributor = createHealthcheckSignalsContributor({ service: source });
    expect(contributor.sourceId).toBe(HEALTHCHECK_SIGNAL_SOURCE_ID);
  });

  it("returns {} and never queries when the principal lacks healthcheck.status", async () => {
    const { source, calls } = sourceReturning(unhealthyStatuses);
    const contributor = createHealthcheckSignalsContributor({ service: source });

    const result = await contributor.read({ principal: userWith([]) });

    expect(result).toEqual({});
    expect(calls()).toBe(0);
  });

  it("treats a service principal as trusted (sees signals)", async () => {
    // Service principals are trusted backend-to-backend callers (the RPC
    // middleware skips access checks for them), so the contributor queries and
    // returns signals rather than gating them out.
    const { source, calls } = sourceReturning(unhealthyStatuses);
    const contributor = createHealthcheckSignalsContributor({ service: source });

    const serviceUser: AuthUser = { type: "service", pluginId: "svc" };
    const result = await contributor.read({ principal: serviceUser });

    expect(Object.keys(result).length).toBeGreaterThan(0);
    expect(calls()).toBe(1);
  });

  it("returns derived signals when the principal holds the qualified status rule", async () => {
    const { source } = sourceReturning(unhealthyStatuses);
    const contributor = createHealthcheckSignalsContributor({ service: source });

    const result = await contributor.read({
      principal: userWith(["healthcheck.healthcheck.status.read"]),
    });

    expect(Object.keys(result)).toEqual(["s1"]);
    expect(result.s1).toHaveLength(1);
    expect(result.s1[0]).toMatchObject({
      source: HEALTHCHECK_SIGNAL_SOURCE_ID,
      tone: "error",
      label: "Unhealthy",
    });
  });

  it("returns derived signals for a wildcard grant", async () => {
    const { source } = sourceReturning(unhealthyStatuses);
    const contributor = createHealthcheckSignalsContributor({ service: source });

    const result = await contributor.read({ principal: userWith(["*"]) });

    expect(Object.keys(result)).toEqual(["s1"]);
  });
});
