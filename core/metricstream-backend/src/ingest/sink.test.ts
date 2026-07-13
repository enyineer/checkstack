import { describe, it, expect } from "bun:test";
import { IngestBuffer, type FlushLoop } from "@checkstack/ingest-utils";
import type { NormalizedDatapoint } from "@checkstack/metricstream-common";
import {
  createMetricSink,
  estimateDatapointBytes,
  type BufferedDatapoint,
} from "./sink";

function dp(name: string, value: number): NormalizedDatapoint {
  return { name, type: "gauge", labels: {}, value, ts: new Date() };
}

function fakeFlushLoop(): FlushLoop & { calls: number } {
  const loop = {
    calls: 0,
    async flushNow() {
      loop.calls += 1;
    },
    start() {},
    stop() {},
  };
  return loop;
}

describe("estimateDatapointBytes", () => {
  it("grows with name + label size", () => {
    const small = estimateDatapointBytes({ streamId: "s", datapoint: dp("m", 1) });
    const big = estimateDatapointBytes({
      streamId: "s",
      datapoint: { ...dp("m", 1), labels: { host: "server-01", zone: "eu" } },
    });
    expect(big).toBeGreaterThan(small);
  });
});

describe("createMetricSink", () => {
  it("buffers accepted datapoints and reports rejections", () => {
    const buffer = new IngestBuffer<BufferedDatapoint>({
      estimateBytes: estimateDatapointBytes,
      globalCap: 2,
    });
    const flushLoop = fakeFlushLoop();
    const sink = createMetricSink({ buffer, flushLoop, flushThreshold: 100 });

    const res = sink.ingest({
      streamId: "s1",
      datapoints: [dp("a", 1), dp("b", 2), dp("c", 3)],
    });
    expect(res.accepted).toBe(2);
    expect(res.rejected).toBe(1);
    expect(buffer.size).toBe(2);
  });

  it("triggers a flush once the threshold is crossed", () => {
    const buffer = new IngestBuffer<BufferedDatapoint>({
      estimateBytes: estimateDatapointBytes,
    });
    const flushLoop = fakeFlushLoop();
    const sink = createMetricSink({ buffer, flushLoop, flushThreshold: 2 });

    sink.ingest({ streamId: "s1", datapoints: [dp("a", 1)] });
    expect(flushLoop.calls).toBe(0);
    sink.ingest({ streamId: "s1", datapoints: [dp("b", 2)] });
    expect(flushLoop.calls).toBe(1);
  });

  it("is a no-op for an empty batch", () => {
    const buffer = new IngestBuffer<BufferedDatapoint>({
      estimateBytes: estimateDatapointBytes,
    });
    const flushLoop = fakeFlushLoop();
    const sink = createMetricSink({ buffer, flushLoop, flushThreshold: 1 });
    expect(sink.ingest({ streamId: "s1", datapoints: [] })).toEqual({
      accepted: 0,
      rejected: 0,
    });
    expect(flushLoop.calls).toBe(0);
  });
});
