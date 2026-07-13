import { describe, it, expect } from "bun:test";
import {
  encodeExportLogsServiceRequest,
  type SatelliteLogBatchItem,
} from "@checkstack/logstream-common";
import {
  buildLogBatchItems,
  createLogReceiverHandlers,
  LOGSTREAM_CAPABILITY_KIND,
  MAX_LINES_PER_ITEM,
  type TelemetryEnqueuer,
} from "./log-receiver";

const TOKEN = "ckls_s1_secret";

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

interface Captured {
  kind: string;
  items: SatelliteLogBatchItem[];
}

function capturingEnqueuer(): {
  enqueue: TelemetryEnqueuer;
  captured: Captured[];
} {
  const captured: Captured[] = [];
  return {
    captured,
    enqueue: {
      enqueue: ({ kind, items }) => {
        captured.push({ kind, items: items as SatelliteLogBatchItem[] });
      },
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

const otlpJson = JSON.stringify({
  resourceLogs: [
    {
      scopeLogs: [
        {
          logRecords: [{ severityNumber: 17, body: { stringValue: "boom" } }],
        },
      ],
    },
  ],
});

describe("agent log receiver", () => {
  it("forwards OTLP JSON logs tagged with the presented token", async () => {
    const { enqueue, captured } = capturingEnqueuer();
    const { otlpLogs } = createLogReceiverHandlers({ enqueue, logger: noopLogger });

    const res = await otlpLogs(
      post("/v1/logs", otlpJson, {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      }),
    );

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 1 });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.kind).toBe(LOGSTREAM_CAPABILITY_KIND);
    expect(captured[0]!.items[0]!.streamToken).toBe(TOKEN);
    expect(captured[0]!.items[0]!.lines[0]!.body).toBe("boom");
    // Wire line carries ISO string timestamps, not Dates.
    expect(typeof captured[0]!.items[0]!.lines[0]!.ts).toBe("string");
  });

  it("forwards OTLP protobuf logs", async () => {
    const { enqueue, captured } = capturingEnqueuer();
    const { otlpLogs } = createLogReceiverHandlers({ enqueue, logger: noopLogger });
    const bytes = encodeExportLogsServiceRequest([
      { records: [{ severityNumber: 9, body: { stringValue: "hi" } }] },
    ]);

    const res = await otlpLogs(
      post("/v1/logs", Buffer.from(bytes), {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/x-protobuf",
      }),
    );

    expect(res.status).toBe(202);
    expect(captured[0]!.items[0]!.lines[0]!.body).toBe("hi");
  });

  it("forwards native NDJSON logs", async () => {
    const { enqueue, captured } = capturingEnqueuer();
    const { nativeLogs } = createLogReceiverHandlers({ enqueue, logger: noopLogger });
    const ndjson = `{"level":"error","message":"one"}\n{"level":"info","message":"two"}`;

    const res = await nativeLogs(
      post("/ingest", ndjson, {
        "x-checkstack-token": TOKEN,
        "content-type": "application/x-ndjson",
      }),
    );

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 2 });
    expect(captured[0]!.items[0]!.lines.map((l) => l.body)).toEqual([
      "one",
      "two",
    ]);
  });

  it("401s when no ckls_-shaped token is present", async () => {
    const { enqueue, captured } = capturingEnqueuer();
    const { otlpLogs } = createLogReceiverHandlers({ enqueue, logger: noopLogger });

    const res = await otlpLogs(
      post("/v1/logs", otlpJson, { "content-type": "application/json" }),
    );
    expect(res.status).toBe(401);

    const wrongShape = await otlpLogs(
      post("/v1/logs", otlpJson, {
        authorization: "Bearer not-a-source-token",
        "content-type": "application/json",
      }),
    );
    expect(wrongShape.status).toBe(401);
    expect(captured).toHaveLength(0);
  });

  it("400s a malformed OTLP body", async () => {
    const { enqueue } = capturingEnqueuer();
    const { otlpLogs } = createLogReceiverHandlers({ enqueue, logger: noopLogger });
    const res = await otlpLogs(
      post("/v1/logs", "{not json", {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("400s an empty native body (no valid records)", async () => {
    const { enqueue } = capturingEnqueuer();
    const { nativeLogs } = createLogReceiverHandlers({ enqueue, logger: noopLogger });
    const res = await nativeLogs(
      post("/ingest", "", {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/x-ndjson",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("405s a non-POST", async () => {
    const { enqueue } = capturingEnqueuer();
    const { nativeLogs } = createLogReceiverHandlers({ enqueue, logger: noopLogger });
    const res = await nativeLogs(
      new Request("http://localhost/ingest", { method: "GET" }),
    );
    expect(res.status).toBe(405);
  });
});

describe("buildLogBatchItems", () => {
  it("splits lines into items of at most MAX_LINES_PER_ITEM", () => {
    const now = new Date();
    const lines = Array.from({ length: MAX_LINES_PER_ITEM * 2 + 5 }, () => ({
      ts: now,
      observedAt: now,
      severityNumber: 9,
      band: "info" as const,
      body: "x",
    }));
    const items = buildLogBatchItems({ streamToken: TOKEN, lines });
    expect(items).toHaveLength(3);
    expect(items[0]!.lines).toHaveLength(MAX_LINES_PER_ITEM);
    expect(items[2]!.lines).toHaveLength(5);
    expect(items.every((i) => i.streamToken === TOKEN)).toBe(true);
  });
});
