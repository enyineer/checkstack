import { describe, it, expect } from "bun:test";
import type { NormalizedLogRecord, TelemetrySignal } from "@checkstack/telemetry-common";
import { createBoundSink, createCountingSink } from "./bound-sink";
import type {
  RegisteredTelemetrySink,
  TelemetrySinkRegistry,
  TelemetrySinkWriteResult,
} from "./extension-points";

const logRecord: NormalizedLogRecord = { ts: new Date(), body: "hello" };

/** Registry whose `logs` sink records writes and returns a fixed result. */
function fakeRegistry({
  writeResult = { accepted: 1, rejected: 0 },
  writes,
}: {
  writeResult?: TelemetrySinkWriteResult;
  writes?: { streamId: string; count: number }[];
} = {}): TelemetrySinkRegistry {
  const logsSink: RegisteredTelemetrySink = {
    signal: "logs",
    ownerPluginId: "logstream",
    assertBindable: async () => {},
    describeStream: async () => null,
    write: async ({ streamId, records }) => {
      writes?.push({ streamId, count: records.length });
      return writeResult;
    },
  };
  return {
    register: () => {},
    get: (signal) => (signal === "logs" ? logsSink : undefined),
    list: () => [logsSink],
  };
}

describe("createBoundSink", () => {
  it("routes a bound signal to its stream and counts accepted", async () => {
    const writes: { streamId: string; count: number }[] = [];
    const { sink, getCounts } = createBoundSink({
      bindings: [{ signal: "logs", streamId: "stream-1" }],
      sinkRegistry: fakeRegistry({ writeResult: { accepted: 2, rejected: 0 }, writes }),
      sourceRef: { sourceId: "src-1", sourceTypeId: "p.type" },
    });
    const result = await sink.emit("logs", [logRecord, logRecord]);
    expect(result).toEqual({ accepted: 2, rejected: 0, bound: true });
    expect(writes).toEqual([{ streamId: "stream-1", count: 2 }]);
    expect(getCounts()).toEqual({ logs: 2 });
  });

  it("returns bound:false for an unbound signal and does not write", async () => {
    const writes: { streamId: string; count: number }[] = [];
    const { sink, getCounts } = createBoundSink({
      bindings: [{ signal: "logs", streamId: "stream-1" }],
      sinkRegistry: fakeRegistry({ writes }),
      sourceRef: { sourceId: "src-1", sourceTypeId: "p.type" },
    });
    const result = await sink.emit(
      "metrics" as TelemetrySignal,
      [] as never[],
    );
    expect(result).toEqual({ accepted: 0, rejected: 0, bound: false });
    expect(writes).toEqual([]);
    expect(getCounts()).toEqual({});
  });

  it("rejects records when the bound signal's sink is not registered", async () => {
    const registry: TelemetrySinkRegistry = {
      register: () => {},
      get: () => undefined,
      list: () => [],
    };
    const { sink } = createBoundSink({
      bindings: [{ signal: "logs", streamId: "stream-1" }],
      sinkRegistry: registry,
      sourceRef: { sourceId: "src-1", sourceTypeId: "p.type" },
    });
    const result = await sink.emit("logs", [logRecord]);
    expect(result).toEqual({ accepted: 0, rejected: 1, bound: true });
  });
});

describe("createCountingSink", () => {
  it("counts records per signal without writing and accepts all type signals", async () => {
    const { sink, getCounts } = createCountingSink({
      signals: ["logs", "metrics"],
    });
    expect([...sink.boundSignals].sort()).toEqual(["logs", "metrics"]);
    const r1 = await sink.emit("logs", [logRecord, logRecord]);
    expect(r1).toEqual({ accepted: 2, rejected: 0, bound: true });
    const r2 = await sink.emit("traces" as TelemetrySignal, [] as never[]);
    expect(r2).toEqual({ accepted: 0, rejected: 0, bound: false });
    expect(getCounts()).toEqual({ logs: 2 });
  });
});
