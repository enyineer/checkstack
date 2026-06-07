import { describe, expect, test } from "bun:test";
import {
  deriveAnomalySignals,
  ANOMALY_SIGNAL_SOURCE_ID,
  type AnomalySignalRow,
} from "./signals";

const row = (over: Partial<AnomalySignalRow>): AnomalySignalRow => ({
  systemId: "sys-1",
  configurationId: "cfg-1",
  fieldPath: "response.latency",
  startedAt: "2026-06-07T10:00:00.000Z",
  state: "anomaly",
  ...over,
});

describe("deriveAnomalySignals", () => {
  test("maps confirmed anomalies to warn and suspicious to info", () => {
    const map = deriveAnomalySignals({
      rows: [
        row({ systemId: "sys-1", state: "anomaly" }),
        row({ systemId: "sys-2", state: "suspicious" }),
      ],
    });

    expect(map["sys-1"]).toHaveLength(1);
    expect(map["sys-1"]?.[0]).toMatchObject({
      source: ANOMALY_SIGNAL_SOURCE_ID,
      tone: "warn",
      label: "Anomaly detected",
      detail: "response.latency",
      iconName: "ChartSpline",
    });

    expect(map["sys-2"]).toHaveLength(1);
    expect(map["sys-2"]?.[0]).toMatchObject({
      source: ANOMALY_SIGNAL_SOURCE_ID,
      tone: "info",
      label: "Suspicious behaviour",
    });
  });

  test("normalises startedAt to an ISO string in `since`", () => {
    const map = deriveAnomalySignals({
      rows: [row({ startedAt: "2026-06-07T10:00:00Z" })],
    });
    expect(map["sys-1"]?.[0]?.since).toBe("2026-06-07T10:00:00.000Z");
  });

  test("skips recovered rows so only problem systems appear", () => {
    const map = deriveAnomalySignals({
      rows: [
        row({ systemId: "sys-ok", state: "recovered" }),
        row({ systemId: "sys-bad", state: "anomaly" }),
      ],
    });
    expect(Object.keys(map)).toEqual(["sys-bad"]);
  });

  test("groups multiple signals under the same system", () => {
    const map = deriveAnomalySignals({
      rows: [
        row({ systemId: "sys-1", fieldPath: "a", state: "anomaly" }),
        row({ systemId: "sys-1", fieldPath: "b", state: "suspicious" }),
      ],
    });
    expect(map["sys-1"]).toHaveLength(2);
    expect(map["sys-1"]?.map((s) => s.detail)).toEqual(["a", "b"]);
  });

  test("injects href and accessRule from caller-supplied builders", () => {
    const accessRule = {
      id: "healthcheck.details.read",
      resource: "healthcheck.details",
      level: "read" as const,
      pluginId: "healthcheck",
      description: "View detailed run data",
    };
    const map = deriveAnomalySignals({
      rows: [row({ systemId: "sys-1", configurationId: "cfg-9" })],
      buildHref: (r) => `/history/${r.systemId}/${r.configurationId}`,
      accessRule,
    });
    expect(map["sys-1"]?.[0]?.href).toBe("/history/sys-1/cfg-9");
    expect(map["sys-1"]?.[0]?.accessRule).toBe(accessRule);
  });

  test("leaves href and accessRule undefined when no builders given", () => {
    const map = deriveAnomalySignals({ rows: [row({})] });
    expect(map["sys-1"]?.[0]?.href).toBeUndefined();
    expect(map["sys-1"]?.[0]?.accessRule).toBeUndefined();
  });
});
