import { describe, expect, test } from "bun:test";
import type { AuthUser } from "@checkstack/backend-api";
import { qualifyAccessRuleId } from "@checkstack/common";
import { anomalyAccess } from "@checkstack/anomaly-common";
import { createAnomalySignalsContributor } from "./system-signals";
import type { AnomalyService } from "./service";

type Rows = Awaited<ReturnType<AnomalyService["getActiveSignalAnomalies"]>>;

const stubService = (rows: Rows): Pick<AnomalyService, "getActiveSignalAnomalies"> => ({
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

describe("createAnomalySignalsContributor", () => {
  test("uses the anomaly source id", () => {
    const contributor = createAnomalySignalsContributor({
      service: stubService([]),
    });
    expect(contributor.sourceId).toBe("anomaly");
  });

  test("returns {} when the principal lacks anomaly read access", async () => {
    const contributor = createAnomalySignalsContributor({
      service: stubService(sampleRows),
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

  test("returns derived signals when the principal has anomaly read access", async () => {
    const contributor = createAnomalySignalsContributor({
      service: stubService(sampleRows),
    });
    const principal: AuthUser = {
      type: "user",
      id: "u1",
      accessRules: [
        qualifyAccessRuleId(
          { pluginId: anomalyAccess.feed.read.pluginId },
          anomalyAccess.feed.read,
        ),
      ],
    };

    const map = await contributor.read({ principal });
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

  test("treats a service principal as trusted", async () => {
    const contributor = createAnomalySignalsContributor({
      service: stubService(sampleRows),
    });
    const principal: AuthUser = { type: "service", pluginId: "scheduler" };

    const map = await contributor.read({ principal });
    expect(Object.keys(map.signals)).toHaveLength(2);
  });
});
