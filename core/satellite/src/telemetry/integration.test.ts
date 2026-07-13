import { describe, it, expect } from "bun:test";
import type { TelemetryBatchMessage } from "@checkstack/satellite-common";
import { TelemetryClient } from "../telemetry-client";
import { createLogReceiverHandlers } from "./log-receiver";
import { createMetricReceiverHandlers } from "./metric-receiver";
import { processSyslogMessages } from "./syslog-listener";
import { buildLogBatchItems, estimateLogItemBytes } from "./log-receiver";
import type { SatelliteLogBatchItem } from "@checkstack/logstream-common";
import type { MetricstreamForwardBatch } from "./metric-wire";

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/**
 * Wire a REAL {@link TelemetryClient} to the receivers and drive one batch out.
 * Proves the receiver -> bounded buffer -> credit-window path end to end on the
 * agent side (the core half is covered by satellite-backend's loopback test).
 */
function connectedClient() {
  const sent: TelemetryBatchMessage[] = [];
  const client = new TelemetryClient({
    send: (msg) => sent.push(msg),
    logger: noopLogger,
    batchMaxItems: 100,
    bufferItemCap: 1000,
  });
  client.onConnected();
  return { client, sent };
}

describe("agent telemetry integration (receiver -> real TelemetryClient)", () => {
  it("forwards native logs through the client as a logstream batch", async () => {
    const { client, sent } = connectedClient();
    const { nativeLogs } = createLogReceiverHandlers({
      enqueue: client,
      logger: noopLogger,
    });

    const res = await nativeLogs(
      new Request("http://localhost/ingest", {
        method: "POST",
        body: `{"level":"error","message":"boom"}`,
        headers: {
          authorization: "Bearer ckls_s1_secret",
          "content-type": "application/x-ndjson",
        },
      }),
    );
    expect(res.status).toBe(202);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.kind).toBe("logstream");
    const items = sent[0]!.payload as SatelliteLogBatchItem[];
    expect(items[0]!.streamToken).toBe("ckls_s1_secret");
    expect(items[0]!.lines[0]!.body).toBe("boom");
    expect(client.inflightCount).toBe(1);
  });

  it("forwards native metrics through the client as a metricstream batch", async () => {
    const { client, sent } = connectedClient();
    const { nativeMetrics } = createMetricReceiverHandlers({
      enqueue: client,
      logger: noopLogger,
    });

    await nativeMetrics(
      new Request("http://localhost/ingest/metrics", {
        method: "POST",
        body: `{"name":"up","value":1}`,
        headers: {
          authorization: "Bearer ckms_s1_secret",
          "content-type": "application/x-ndjson",
        },
      }),
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]!.kind).toBe("metricstream");
    const items = sent[0]!.payload as MetricstreamForwardBatch;
    expect(items[0]!.streamToken).toBe("ckms_s1_secret");
    expect(items[0]!.datapoints[0]!.name).toBe("up");
  });

  it("forwards syslog-derived lines through the client grouped by token", () => {
    const { client, sent } = connectedClient();
    const result = processSyslogMessages({
      messages: [
        `<13>1 2026-07-13T00:00:00Z host app 1 - [checkstack@50501 token="ckls_a_1"] hello`,
      ],
      now: new Date(),
    });
    for (const [streamToken, lines] of result.byToken) {
      client.enqueue({
        kind: "logstream",
        items: buildLogBatchItems({ streamToken, lines }),
        estimateBytes: estimateLogItemBytes,
        groupKeyOf: () => streamToken,
      });
    }

    expect(sent).toHaveLength(1);
    const items = sent[0]!.payload as SatelliteLogBatchItem[];
    expect(items[0]!.streamToken).toBe("ckls_a_1");
    expect(items[0]!.lines[0]!.body).toBe("hello");
  });
});
