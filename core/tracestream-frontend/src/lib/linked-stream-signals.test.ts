import { describe, it, expect } from "bun:test";
import type { LinkedStreamStatus } from "@checkstack/telemetry-common";
import { tracestreamAccess } from "@checkstack/tracestream-common";
import {
  TRACESTREAM_SIGNAL_SOURCE_ID,
  deriveTraceStreamSignals,
} from "./linked-stream-signals";

const accessRule = tracestreamAccess.read;

function status(over: Partial<LinkedStreamStatus>): LinkedStreamStatus {
  return {
    id: "stream-1",
    name: "Payments traces",
    systemIds: ["sys-1"],
    lastImportantEvent: null,
    ...over,
  };
}

describe("deriveTraceStreamSignals", () => {
  it("maps error_spike to an error signal", () => {
    const ts = new Date("2026-07-14T10:00:00.000Z");
    const map = deriveTraceStreamSignals({
      matches: [
        status({
          id: "s-err",
          name: "Errs",
          systemIds: ["sys-1"],
          lastImportantEvent: { type: "error_spike", ts },
        }),
      ],
      accessRule,
    });

    expect(map["sys-1"]).toHaveLength(1);
    expect(map["sys-1"]![0]).toMatchObject({
      source: TRACESTREAM_SIGNAL_SOURCE_ID,
      tone: "error",
      label: "Trace error spike",
      detail: "Errs",
      accessRule,
      since: ts.toISOString(),
    });
    expect(map["sys-1"]![0]!.href).toContain("s-err");
  });

  it("does NOT surface silence (that is the health strategy's job, not a signal)", () => {
    const map = deriveTraceStreamSignals({
      matches: [
        status({
          id: "s-silent",
          systemIds: ["sys-2"],
          lastImportantEvent: {
            type: "silence",
            ts: new Date("2026-07-14T10:00:00.000Z"),
          },
        }),
      ],
      accessRule,
    });
    expect(Object.keys(map)).toHaveLength(0);
  });

  it("attributes a stream's signal to EVERY system it links", () => {
    const map = deriveTraceStreamSignals({
      matches: [
        status({
          systemIds: ["sys-a", "sys-b"],
          lastImportantEvent: {
            type: "error_spike",
            ts: new Date("2026-07-14T10:00:00.000Z"),
          },
        }),
      ],
      accessRule,
    });
    expect(map["sys-a"]).toHaveLength(1);
    expect(map["sys-b"]).toHaveLength(1);
  });

  it("skips streams with no event and non-actionable event types", () => {
    const map = deriveTraceStreamSignals({
      matches: [
        status({ id: "none", lastImportantEvent: null }),
        status({
          id: "rate",
          lastImportantEvent: {
            type: "rate_limited",
            ts: new Date("2026-07-14T10:00:00.000Z"),
          },
        }),
        status({
          id: "recovered",
          lastImportantEvent: {
            type: "silence_recovered",
            ts: new Date("2026-07-14T10:00:00.000Z"),
          },
        }),
      ],
      accessRule,
    });
    expect(Object.keys(map)).toHaveLength(0);
  });
});
