import { describe, it, expect } from "bun:test";
import type { LinkedStreamStatus } from "@checkstack/telemetry-common";
import {
  deriveLogstreamSignals,
  LOGSTREAM_SIGNAL_SOURCE_ID,
} from "./system-signals.logic";

const status = (
  over: Partial<LinkedStreamStatus> & Pick<LinkedStreamStatus, "id">,
): LinkedStreamStatus => ({
  id: over.id,
  name: over.name ?? "Payments logs",
  systemIds: over.systemIds ?? ["sys-1"],
  lastImportantEvent: over.lastImportantEvent ?? null,
});

const spike = (ts: string) => ({ type: "spike", ts: new Date(ts) });

describe("deriveLogstreamSignals", () => {
  it("emits one error-tone signal per spiking stream, keyed by every linked system", () => {
    const map = deriveLogstreamSignals({
      statuses: [
        status({
          id: "stream-1",
          name: "Payments logs",
          systemIds: ["sys-1", "sys-2"],
          lastImportantEvent: spike("2026-07-14T10:00:00.000Z"),
        }),
      ],
    });
    expect(Object.keys(map).sort()).toEqual(["sys-1", "sys-2"]);
    const signal = map["sys-1"]![0]!;
    expect(signal).toMatchObject({
      source: LOGSTREAM_SIGNAL_SOURCE_ID,
      tone: "error",
      label: "Log error spike",
      detail: "Payments logs",
      since: "2026-07-14T10:00:00.000Z",
      iconName: "ScrollText",
    });
    expect(signal.href).toContain("stream-1");
    expect(signal.accessRule).toBeDefined();
    // Same signal object is attributed to both linked systems.
    expect(map["sys-2"]![0]!.detail).toBe("Payments logs");
  });

  it("ignores non-spike events (silence is the health strategy's job) and null", () => {
    const map = deriveLogstreamSignals({
      statuses: [
        status({ id: "a", lastImportantEvent: null }),
        status({
          id: "b",
          lastImportantEvent: { type: "silence", ts: new Date() },
        }),
        status({
          id: "c",
          lastImportantEvent: { type: "new_pattern", ts: new Date() },
        }),
      ],
    });
    expect(map).toEqual({});
  });

  it("returns an empty map for no statuses", () => {
    expect(deriveLogstreamSignals({ statuses: [] })).toEqual({});
  });
});
