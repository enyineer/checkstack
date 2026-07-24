import { describe, it, expect } from "bun:test";
import {
  HEALTHCHECK_SIGNAL_SOURCE_ID,
  type HealthcheckSignalStatuses,
} from "@checkstack/healthcheck-common";
import type { AuthUser } from "@checkstack/backend-api";
import type { SystemAccessResolver } from "@checkstack/ai-backend";
import {
  createHealthcheckSignalsContributor,
  type HealthcheckCandidateSource,
  type HealthcheckStatusCacheReader,
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
        sliceCount: 1,
        failingSliceCount: 1,
        slices: [],
      },
    ],
  },
};

/**
 * Build a candidate source + cache reader pair from a fixed status map: the
 * candidate ids are the map's keys, and `readBulk` returns the requested subset.
 * This mirrors the real wiring (service scans candidates, cache serves statuses).
 */
function sourceReturning(statuses: HealthcheckSignalStatuses): {
  candidateSource: HealthcheckCandidateSource;
  cache: HealthcheckStatusCacheReader;
} {
  return {
    candidateSource: {
      getUnhealthyCandidateSystemIds: async () => Object.keys(statuses),
    },
    cache: {
      readBulk: async (systemIds) => {
        const out: HealthcheckSignalStatuses = {};
        for (const id of systemIds) {
          const s = statuses[id];
          if (s) out[id] = s;
        }
        return out;
      },
    },
  };
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
    const { candidateSource, cache } = sourceReturning({});
    const contributor = createHealthcheckSignalsContributor({
      candidateSource,
      cache,
      resolver: allowAll,
    });
    expect(contributor.sourceId).toBe(HEALTHCHECK_SIGNAL_SOURCE_ID);
  });

  it("wires the service + shared deriver for an authorized principal", async () => {
    const { candidateSource, cache } = sourceReturning(unhealthyStatuses);
    const contributor = createHealthcheckSignalsContributor({
      candidateSource,
      cache,
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
    const { candidateSource, cache } = sourceReturning(unhealthyStatuses);
    const contributor = createHealthcheckSignalsContributor({
      candidateSource,
      cache,
      resolver: denyAll,
    });

    const result = await contributor.read({ principal: userWith([]) });

    expect(result).toEqual({ accessible: false, signals: {} });
  });
});
