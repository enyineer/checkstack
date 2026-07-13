import { describe, it, expect } from "bun:test";
import {
  buildMetricBatchItems,
  createMetricReceiverHandlers,
  MAX_DATAPOINTS_PER_ITEM,
  METRICSTREAM_TELEMETRY_KIND,
} from "./metric-receiver";
import type { TelemetryEnqueuer } from "./enqueuer";
import type { MetricstreamForwardBatch } from "./metric-wire";

type SatelliteMetricBatchItem = MetricstreamForwardBatch[number];

const TOKEN = "ckms_s1_secret";

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function capturingEnqueuer(): {
  enqueue: TelemetryEnqueuer;
  captured: { kind: string; items: SatelliteMetricBatchItem[] }[];
} {
  const captured: { kind: string; items: SatelliteMetricBatchItem[] }[] = [];
  return {
    captured,
    enqueue: {
      enqueue: ({ kind, items }) =>
        captured.push({ kind, items: items as SatelliteMetricBatchItem[] }),
    },
  };
}

function post(
  url: string,
  body: BodyInit,
  headers: Record<string, string>,
): Request {
  return new Request(`http://localhost${url}`, { method: "POST", body, headers });
}

describe("agent metric receiver", () => {
  it("forwards native NDJSON metrics tagged with the presented token", async () => {
    const { enqueue, captured } = capturingEnqueuer();
    const { nativeMetrics } = createMetricReceiverHandlers({
      enqueue,
      logger: noopLogger,
    });
    const ndjson =
      `{"name":"up","value":1,"labels":{"job":"api"}}\n` +
      `{"name":"reqs","type":"counter","value":42}`;

    const res = await nativeMetrics(
      post("/ingest/metrics", ndjson, {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/x-ndjson",
      }),
    );

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 2 });
    expect(captured[0]!.kind).toBe(METRICSTREAM_TELEMETRY_KIND);
    expect(captured[0]!.items[0]!.streamToken).toBe(TOKEN);
    expect(captured[0]!.items[0]!.datapoints.map((d) => d.name)).toEqual([
      "up",
      "reqs",
    ]);
    expect(typeof captured[0]!.items[0]!.datapoints[0]!.ts).toBe("string");
  });

  it("401s a missing / wrong-prefix (ckls_) token", async () => {
    const { enqueue, captured } = capturingEnqueuer();
    const { nativeMetrics } = createMetricReceiverHandlers({
      enqueue,
      logger: noopLogger,
    });
    const res = await nativeMetrics(
      post("/ingest/metrics", `{"name":"up","value":1}`, {
        authorization: "Bearer ckls_wrong_kind",
        "content-type": "application/x-ndjson",
      }),
    );
    expect(res.status).toBe(401);
    expect(captured).toHaveLength(0);
  });

  it("400s an empty native body", async () => {
    const { enqueue } = capturingEnqueuer();
    const { nativeMetrics } = createMetricReceiverHandlers({
      enqueue,
      logger: noopLogger,
    });
    const res = await nativeMetrics(
      post("/ingest/metrics", "", {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/x-ndjson",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("forwards OTLP JSON metrics", async () => {
    const { enqueue, captured } = capturingEnqueuer();
    const { otlpMetrics } = createMetricReceiverHandlers({
      enqueue,
      logger: noopLogger,
    });
    const otlpJson = JSON.stringify({
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "reqs",
                  sum: {
                    isMonotonic: true,
                    aggregationTemporality:
                      "AGGREGATION_TEMPORALITY_CUMULATIVE",
                    dataPoints: [
                      { timeUnixNano: "1700000000000000000", asInt: "42" },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    const res = await otlpMetrics(
      post("/v1/metrics", otlpJson, {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      }),
    );
    expect(res.status).toBe(202);
    expect(captured[0]!.items[0]!.datapoints[0]!.name).toBe("reqs");
  });
});

describe("buildMetricBatchItems", () => {
  it("splits datapoints into items of at most MAX_DATAPOINTS_PER_ITEM", () => {
    const now = new Date();
    const datapoints = Array.from(
      { length: MAX_DATAPOINTS_PER_ITEM + 3 },
      () => ({ name: "m", type: "gauge" as const, labels: {}, value: 1, ts: now }),
    );
    const items = buildMetricBatchItems({ streamToken: TOKEN, datapoints });
    expect(items).toHaveLength(2);
    expect(items[0]!.datapoints).toHaveLength(MAX_DATAPOINTS_PER_ITEM);
    expect(items[1]!.datapoints).toHaveLength(3);
  });
});
