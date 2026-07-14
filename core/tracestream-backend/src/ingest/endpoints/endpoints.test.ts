import { describe, it, expect } from "bun:test";
import { createMockLogger } from "@checkstack/test-utils-backend";
import {
  DEFAULT_TRACE_STREAM_CONFIG,
  type TraceStreamConfig,
} from "@checkstack/tracestream-common";
import type { IngestAuthenticator, IngestAuthResult } from "@checkstack/ingest-utils";
import type { IngestPipeline, IngestResult } from "../pipeline";
import type { StreamConfigResolver } from "../stream-config";
import { PreAuthRateLimiter } from "@checkstack/ingest-utils";
import { createOtlpTracesHandler } from "./otlp";
import { createNativeTracesHandler } from "./native";
import { authenticateRequest } from "./authenticate";

const TRACE_ID = "5b8aa5a2d2c872e8321cf37308d69df2";
const SPAN_ID = "051581bf3cb55c13";

function auth(result: IngestAuthResult): IngestAuthenticator {
  return { verify: async () => result };
}

const configResolver: StreamConfigResolver = {
  resolve: async () => DEFAULT_TRACE_STREAM_CONFIG as TraceStreamConfig,
};

function pipe(result: IngestResult): {
  pipeline: IngestPipeline;
  calls: { spans: number }[];
} {
  const calls: { spans: number }[] = [];
  const pipeline: IngestPipeline = {
    ingest: ({ spans }) => {
      calls.push({ spans: spans.length });
      return result;
    },
    flushNow: async () => {},
    start: () => {},
    stop: () => {},
  };
  return { pipeline, calls };
}

const OK_RESULT: IngestResult = {
  accepted: 1,
  rejectedRateLimit: 0,
  rejectedBuffer: 0,
  retryAfterSeconds: 0,
};

function otlpJsonBody(spans: unknown[]): string {
  return JSON.stringify({
    resourceSpans: [{ scopeSpans: [{ spans }] }],
  });
}

function post(url: string, body: string, headers: Record<string, string>): Request {
  return new Request(url, { method: "POST", headers, body });
}

const OK_AUTH = auth({ ok: true, resourceId: "s1", tokenId: "t1" });

describe("OTLP traces endpoint", () => {
  it("401s a request with no token", async () => {
    const handler = createOtlpTracesHandler({
      auth: OK_AUTH,
      configResolver,
      pipeline: pipe(OK_RESULT).pipeline,
      logger: createMockLogger(),
    });
    const res = await handler(
      post("http://x/api/tracestream/v1/traces", "{}", {
        "content-type": "application/json",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("401s a revoked token with an actionable message", async () => {
    const res = await authenticateRequest({
      request: post("http://x/", "{}", {
        authorization: "Bearer cktr_revoked",
        "content-type": "application/json",
      }),
      auth: auth({ ok: false, reason: "revoked" }),
      preAuthLimiter: new PreAuthRateLimiter(),
    });
    expect(res).toBeInstanceOf(Response);
    const body = await (res as Response).json();
    expect((res as Response).status).toBe(401);
    expect(body.error).toContain("revoked");
  });

  it("accepts a valid JSON export and reports rejected spans via partialSuccess", async () => {
    const { pipeline, calls } = pipe({ ...OK_RESULT, accepted: 1 });
    const handler = createOtlpTracesHandler({
      auth: OK_AUTH,
      configResolver,
      pipeline,
      logger: createMockLogger(),
    });
    const res = await handler(
      post(
        "http://x/api/tracestream/v1/traces",
        otlpJsonBody([
          { traceId: TRACE_ID, spanId: SPAN_ID, name: "ok", kind: 2 },
          { traceId: "bad", spanId: SPAN_ID, name: "bad", kind: 2 }, // rejected
        ]),
        { authorization: "Bearer cktr_ok", "content-type": "application/json" },
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.partialSuccess.rejectedSpans).toBe(1);
    expect(calls[0]!.spans).toBe(1); // only the valid span reached the pipeline
  });

  it("429s with Retry-After when the pipeline admits nothing", async () => {
    const handler = createOtlpTracesHandler({
      auth: OK_AUTH,
      configResolver,
      pipeline: pipe({
        accepted: 0,
        rejectedRateLimit: 1,
        rejectedBuffer: 0,
        retryAfterSeconds: 42,
      }).pipeline,
      logger: createMockLogger(),
    });
    const res = await handler(
      post(
        "http://x/api/tracestream/v1/traces",
        otlpJsonBody([{ traceId: TRACE_ID, spanId: SPAN_ID, name: "op", kind: 2 }]),
        { authorization: "Bearer cktr_ok", "content-type": "application/json" },
      ),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
  });

  it("400s a malformed JSON body", async () => {
    const handler = createOtlpTracesHandler({
      auth: OK_AUTH,
      configResolver,
      pipeline: pipe(OK_RESULT).pipeline,
      logger: createMockLogger(),
    });
    const res = await handler(
      post("http://x/api/tracestream/v1/traces", "{not json", {
        authorization: "Bearer cktr_ok",
        "content-type": "application/json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("405s a non-POST method", async () => {
    const handler = createOtlpTracesHandler({
      auth: OK_AUTH,
      configResolver,
      pipeline: pipe(OK_RESULT).pipeline,
      logger: createMockLogger(),
    });
    const res = await handler(new Request("http://x/api/tracestream/v1/traces", { method: "GET" }));
    expect(res.status).toBe(405);
  });
});

describe("native traces endpoint", () => {
  it("202s with accepted/rejected counts", async () => {
    const handler = createNativeTracesHandler({
      auth: OK_AUTH,
      configResolver,
      pipeline: pipe({ ...OK_RESULT, accepted: 1 }).pipeline,
      logger: createMockLogger(),
    });
    const res = await handler(
      post(
        "http://x/api/tracestream/ingest",
        JSON.stringify([
          { traceId: TRACE_ID, spanId: SPAN_ID, name: "op", startTs: 1 },
        ]),
        { authorization: "Bearer cktr_ok", "content-type": "application/json" },
      ),
    );
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.accepted).toBe(1);
  });

  it("400s a body with no valid spans", async () => {
    const handler = createNativeTracesHandler({
      auth: OK_AUTH,
      configResolver,
      pipeline: pipe(OK_RESULT).pipeline,
      logger: createMockLogger(),
    });
    const res = await handler(
      post("http://x/api/tracestream/ingest", JSON.stringify([]), {
        authorization: "Bearer cktr_ok",
        "content-type": "application/json",
      }),
    );
    expect(res.status).toBe(400);
  });
});
