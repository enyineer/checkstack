import { describe, expect, test } from "bun:test";
import type { AuthUser } from "@checkstack/backend-api";
import { qualifyAccessRuleId } from "@checkstack/common";
import type { SystemAccessResolver } from "@checkstack/ai-backend";
import { anomalyAccess } from "@checkstack/anomaly-common";
import { createAnomalySignalsContributor } from "./system-signals";
import type { AnomalyService } from "./service";

type Rows = Awaited<ReturnType<AnomalyService["getActiveSignalAnomalies"]>>;

const stubService = (
  rows: Rows,
): Pick<AnomalyService, "getActiveSignalAnomalies"> => ({
  getActiveSignalAnomalies: async () => rows,
});

const sampleRows: Rows = [
  {
    systemId: "sys-1",
    configurationId: "cfg-1",
    fieldPath: "latency",
    startedAt: "2026-06-07T10:00:00.000Z",
    state: "anomaly",
  },
  {
    systemId: "sys-2",
    configurationId: "cfg-2",
    fieldPath: "errors",
    startedAt: "2026-06-07T11:00:00.000Z",
    state: "suspicious",
  },
];

// The per-source gate is owned/tested by createGatedSystemSignalsContributor.
const allowAll: SystemAccessResolver = {
  accessibleSystemIds: async ({ systemIds }) => systemIds,
};
const denyAll: SystemAccessResolver = { accessibleSystemIds: async () => [] };

const withFeedRead: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: [
    qualifyAccessRuleId(
      { pluginId: anomalyAccess.feed.read.pluginId },
      anomalyAccess.feed.read,
    ),
  ],
};

describe("createAnomalySignalsContributor", () => {
  test("uses the anomaly source id", () => {
    const contributor = createAnomalySignalsContributor({
      service: stubService([]),
      resolver: allowAll,
    });
    expect(contributor.sourceId).toBe("anomaly");
  });

  test("wires the service + shared deriver for an authorized principal", async () => {
    const contributor = createAnomalySignalsContributor({
      service: stubService(sampleRows),
      resolver: allowAll,
    });

    const map = await contributor.read({ principal: withFeedRead });

    expect(Object.keys(map.signals).sort()).toEqual(["sys-1", "sys-2"]);
    expect(map.signals["sys-1"]?.[0]).toMatchObject({
      source: "anomaly",
      tone: "warn",
      label: "Anomaly detected",
    });
    expect(map.signals["sys-2"]?.[0]).toMatchObject({
      source: "anomaly",
      tone: "info",
      label: "Suspicious behaviour",
    });
  });

  test("routes a non-global user through the team gate (no grants -> nothing)", async () => {
    const contributor = createAnomalySignalsContributor({
      service: stubService(sampleRows),
      resolver: denyAll,
    });
    const principal: AuthUser = {
      type: "user",
      id: "u1",
      accessRules: ["catalog.system.read"],
    };

    expect(await contributor.read({ principal })).toEqual({
      accessible: false,
      signals: {},
    });
  });
});
