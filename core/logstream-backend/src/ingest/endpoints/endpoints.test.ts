import { describe, it, expect, mock } from "bun:test";
import { gzipSync } from "node:zlib";
import { createMockLogger } from "@checkstack/test-utils-backend";
import { DEFAULT_LOG_STREAM_CONFIG } from "@checkstack/logstream-common";
import type { IngestAuthenticator } from "../auth";
import type { StreamConfigResolver } from "../stream-config";
import type { IngestPipeline, IngestResult } from "../pipeline";
import { encodeExportLogsServiceRequest } from "@checkstack/logstream-common";
import { createOtlpLogsHandler } from "./otlp";
import { createNativeIngestHandler } from "./native";

const GOOD = "ckls_s_secret";

function auth(): IngestAuthenticator {
  return {
    verify: async (token) =>
      token === GOOD
        ? { ok: true, streamId: "s1", tokenId: "t1" }
        : { ok: false, reason: "unknown" },
  };
}

const configResolver: StreamConfigResolver = {
  resolve: async () => DEFAULT_LOG_STREAM_CONFIG,
};

function pipeline(result: IngestResult): {
  pipeline: IngestPipeline;
  ingest: ReturnType<typeof mock>;
} {
  const ingest = mock(() => result);
  return {
    pipeline: { ingest, flushNow: async () => {}, start: () => {}, stop: () => {} } as unknown as IngestPipeline,
    ingest,
  };
}

const accepted = (n: number): IngestResult => ({
  accepted: n,
  rejectedRateLimit: 0,
  rejectedBuffer: 0,
  retryAfterSeconds: 0,
});

function post(body: BodyInit, headers: Record<string, string>): Request {
  return new Request("http://localhost/api/logstream/v1/logs", {
    method: "POST",
    body,
    headers: { authorization: `Bearer ${GOOD}`, ...headers },
  });
}

const otlpJsonBody = JSON.stringify({
  resourceLogs: [
    {
      scopeLogs: [
        {
          logRecords: [
            { severityNumber: 17, body: { stringValue: "boom" } },
          ],
        },
      ],
    },
  ],
});

describe("OTLP handler", () => {
  it("401s without a token", async () => {
    const handler = createOtlpLogsHandler({
      auth: auth(),
      configResolver,
      pipeline: pipeline(accepted(1)).pipeline,
      logger: createMockLogger(),
    });
    const res = await handler(
      new Request("http://localhost/api/logstream/v1/logs", { method: "POST", body: otlpJsonBody }),
    );
    expect(res.status).toBe(401);
  });

  it("accepts a JSON body and returns an empty ExportLogsServiceResponse", async () => {
    const { pipeline: pl, ingest } = pipeline(accepted(1));
    const handler = createOtlpLogsHandler({ auth: auth(), configResolver, pipeline: pl, logger: createMockLogger() });
    const res = await handler(post(otlpJsonBody, { "content-type": "application/json" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it("accepts a protobuf body and replies in protobuf", async () => {
    const bytes = encodeExportLogsServiceRequest([
      { records: [{ severityNumber: 9, body: { stringValue: "hi" } }] },
    ]);
    const { pipeline: pl } = pipeline(accepted(1));
    const handler = createOtlpLogsHandler({ auth: auth(), configResolver, pipeline: pl, logger: createMockLogger() });
    const res = await handler(post(new Uint8Array(bytes), { "content-type": "application/x-protobuf" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-protobuf");
  });

  it("accepts a gzipped JSON body", async () => {
    const gz = new Uint8Array(gzipSync(Buffer.from(otlpJsonBody)));
    const { pipeline: pl } = pipeline(accepted(1));
    const handler = createOtlpLogsHandler({ auth: auth(), configResolver, pipeline: pl, logger: createMockLogger() });
    const res = await handler(post(gz, { "content-type": "application/json", "content-encoding": "gzip" }));
    expect(res.status).toBe(200);
  });

  it("returns 429 with Retry-After when the buffer is saturated", async () => {
    const { pipeline: pl } = pipeline({ accepted: 0, rejectedRateLimit: 5, rejectedBuffer: 0, retryAfterSeconds: 20 });
    const handler = createOtlpLogsHandler({ auth: auth(), configResolver, pipeline: pl, logger: createMockLogger() });
    const res = await handler(post(otlpJsonBody, { "content-type": "application/json" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("20");
  });

  it("reports partialSuccess when some records were dropped", async () => {
    const { pipeline: pl } = pipeline({ accepted: 1, rejectedRateLimit: 0, rejectedBuffer: 3, retryAfterSeconds: 0 });
    const handler = createOtlpLogsHandler({ auth: auth(), configResolver, pipeline: pl, logger: createMockLogger() });
    const res = await handler(post(otlpJsonBody, { "content-type": "application/json" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      partialSuccess: { rejectedLogRecords: 3, errorMessage: "some records were dropped" },
    });
  });

  it("counts an empty record (mixed with a valid one) as a rejected partial success", async () => {
    // parse/otlp normalizeRecord rejects a record with an empty body AND no
    // attributes; the handler forwards that count into partialSuccess.
    const mixed = JSON.stringify({
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                { severityNumber: 17, body: { stringValue: "boom" } }, // valid
                {}, // empty: no body, no attributes -> rejected
              ],
            },
          ],
        },
      ],
    });
    const { pipeline: pl } = pipeline(accepted(1));
    const handler = createOtlpLogsHandler({ auth: auth(), configResolver, pipeline: pl, logger: createMockLogger() });
    const res = await handler(post(mixed, { "content-type": "application/json" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      partialSuccess: { rejectedLogRecords: 1, errorMessage: "some records were dropped" },
    });
  });

  it("413s an oversize body", async () => {
    const big = new Uint8Array(11 * 1024 * 1024);
    const { pipeline: pl } = pipeline(accepted(1));
    const handler = createOtlpLogsHandler({ auth: auth(), configResolver, pipeline: pl, logger: createMockLogger() });
    const res = await handler(post(big, { "content-type": "application/x-protobuf" }));
    expect(res.status).toBe(413);
  });
});

describe("native handler", () => {
  function nativePost(body: BodyInit, headers: Record<string, string>): Request {
    return new Request("http://localhost/api/logstream/ingest", {
      method: "POST",
      body,
      headers: { authorization: `Bearer ${GOOD}`, ...headers },
    });
  }

  it("accepts NDJSON and returns 202 with counts", async () => {
    const { pipeline: pl, ingest } = pipeline(accepted(2));
    const handler = createNativeIngestHandler({ auth: auth(), configResolver, pipeline: pl, logger: createMockLogger() });
    const body = '{"level":"info","message":"a"}\n{"level":"error","message":"b"}';
    const res = await handler(nativePost(body, { "content-type": "application/x-ndjson" }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 2, rejected: 0 });
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it("400s a wholly-malformed body", async () => {
    const { pipeline: pl } = pipeline(accepted(0));
    const handler = createNativeIngestHandler({ auth: auth(), configResolver, pipeline: pl, logger: createMockLogger() });
    const res = await handler(nativePost("{not json", { "content-type": "application/json" }));
    expect(res.status).toBe(400);
  });

  it("429s when saturated", async () => {
    const { pipeline: pl } = pipeline({ accepted: 0, rejectedRateLimit: 3, rejectedBuffer: 0, retryAfterSeconds: 15 });
    const handler = createNativeIngestHandler({ auth: auth(), configResolver, pipeline: pl, logger: createMockLogger() });
    const res = await handler(nativePost('[{"message":"a"}]', { "content-type": "application/json" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("15");
  });
});
