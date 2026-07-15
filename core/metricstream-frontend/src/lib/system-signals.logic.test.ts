import { describe, it, expect } from "bun:test";
import type { LinkedStreamStatus } from "@checkstack/telemetry-common";
import {
  deriveMetricstreamSignals,
  METRICSTREAM_SIGNAL_SOURCE_ID,
} from "./system-signals.logic";

const status = (
  over: Partial<LinkedStreamStatus> & Pick<LinkedStreamStatus, "id">,
): LinkedStreamStatus => ({
  name: `Stream ${over.id}`,
  systemIds: ["sys-1"],
  lastImportantEvent: null,
  ...over,
});

describe("deriveMetricstreamSignals", () => {
  it("emits an error signal for scrape_failing, keyed per linked system", () => {
    const map = deriveMetricstreamSignals({
      statuses: [
        status({
          id: "s1",
          systemIds: ["sys-1", "sys-2"],
          lastImportantEvent: { type: "scrape_failing", ts: new Date("2026-02-01T00:00:00Z") },
        }),
      ],
    });
    expect(Object.keys(map).sort()).toEqual(["sys-1", "sys-2"]);
    const signal = map["sys-1"]![0]!;
    expect(signal.source).toBe(METRICSTREAM_SIGNAL_SOURCE_ID);
    expect(signal.tone).toBe("error");
    expect(signal.label).toBe("Metric scrape failing");
    expect(signal.detail).toBe("Stream s1");
    expect(signal.href).toContain("s1");
  });

  it("emits a warn signal for series_cap", () => {
    const map = deriveMetricstreamSignals({
      statuses: [
        status({
          id: "s2",
          lastImportantEvent: { type: "series_cap", ts: new Date("2026-02-01T00:00:00Z") },
        }),
      ],
    });
    expect(map["sys-1"]![0]!.tone).toBe("warn");
  });

  it("does NOT surface silence, silence_recovered, or no event (health strategy territory)", () => {
    const map = deriveMetricstreamSignals({
      statuses: [
        status({ id: "a", lastImportantEvent: { type: "silence", ts: new Date() } }),
        status({
          id: "b",
          lastImportantEvent: { type: "silence_recovered", ts: new Date() },
        }),
        status({ id: "c", lastImportantEvent: null }),
      ],
    });
    expect(map).toEqual({});
  });
});
