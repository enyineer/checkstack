import { describe, it, expect } from "bun:test";
import {
  HEALTHCHECK_SIGNAL_SOURCE_ID,
  type HealthcheckSignalStatuses,
} from "@checkstack/healthcheck-common";
import type { AuthUser } from "@checkstack/backend-api";
import type { SystemAccessResolver } from "@checkstack/ai-backend";
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

function sourceReturning(statuses: HealthcheckSignalStatuses): {
  source: HealthcheckSignalsSource;
} {
  return { source: { getAllUnhealthySystemStatuses: async () => statuses } };
}

// The per-source gate is owned/tested by createGatedSystemSignalsContributor;
// these resolver stubs let us focus on this plugin's wiring.
const allowAll: SystemAccessResolver = {
  accessibleSystemIds: async ({ systemIds }) => systemIds,
};
const denyAll: SystemAccessResolver = { accessibleSystemIds: async () => [] };
const userWith = (accessRules: string[]): AuthUser => ({
  type: "user",
  id: "u1",
  accessRules,
});

describe("createHealthcheckSignalsContributor", () => {
  it("exposes the shared source id", () => {
    const { source } = sourceReturning({});
    const contributor = createHealthcheckSignalsContributor({
      service: source,
      resolver: allowAll,
    });
    expect(contributor.sourceId).toBe(HEALTHCHECK_SIGNAL_SOURCE_ID);
  });

  it("wires the service + shared deriver for an authorized principal", async () => {
    const { source } = sourceReturning(unhealthyStatuses);
    const contributor = createHealthcheckSignalsContributor({
      service: source,
      resolver: allowAll,
    });

    const result = await contributor.read({
      principal: userWith(["healthcheck.healthcheck.status.read"]),
    });

    expect(Object.keys(result.signals)).toEqual(["s1"]);
    expect(result.signals.s1[0]).toMatchObject({
      source: HEALTHCHECK_SIGNAL_SOURCE_ID,
      tone: "error",
      label: "Unhealthy",
    });
  });

  it("routes a non-global user through the team gate (no grants -> nothing)", async () => {
    const { source } = sourceReturning(unhealthyStatuses);
    const contributor = createHealthcheckSignalsContributor({
      service: source,
      resolver: denyAll,
    });

    const result = await contributor.read({ principal: userWith([]) });

    expect(result).toEqual({ accessible: false, signals: {} });
  });
});
