/**
 * Behaviour tests for the webhook automation action.
 *
 * fetch is stubbed in-process so we can exercise the full
 * `webhookSendAction.execute` flow including the retry/error mapping.
 * Template expansion happens at the dispatch-engine level — by the
 * time this action runs, `config.body` is already a rendered string,
 * so we don't need to set up a template runtime here.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import type { Logger, RpcClient } from "@checkstack/backend-api";
import { createMockLogger } from "@checkstack/test-utils-backend";

import { webhookSendAction, webhookDeliveryArtifactType } from "./automations";

const logger = createMockLogger() as Logger;

interface CapturedFetchCall {
  url: string;
  init: RequestInit;
}

interface StagedResponse {
  body?: unknown;
  status?: number;
  headers?: Record<string, string>;
  raw?: string;
  /** Throw this error instead of returning a response. */
  throws?: Error;
}

function setupFetchSequence(responses: StagedResponse[]) {
  const calls: CapturedFetchCall[] = [];
  const originalFetch = globalThis.fetch;
  let i = 0;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls.push({ url: String(input), init: init ?? {} });
    const next = responses[i++] ?? { body: {}, status: 200 };
    if (next.throws) throw next.throws;
    const headers = new Headers({ "Content-Type": "application/json", ...next.headers });
    const payload =
      next.raw !== undefined ? next.raw : JSON.stringify(next.body ?? {});
    return new Response(payload, {
      status: next.status ?? 200,
      headers,
    });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

let fetchFixture: ReturnType<typeof setupFetchSequence> | undefined;

beforeEach(() => {
  fetchFixture?.restore();
  fetchFixture = undefined;
});

const ctxBase = {
  runId: "run-1",
  automationId: "auto-1",
  contextKey: null,
  logger,
  getService: async <T,>(): Promise<T> => {
    throw new Error("not used");
  },
  rpcClient: { forPlugin: () => ({}) } as unknown as RpcClient,
};

const baseConfig = {
  url: "https://example.com/hook",
  method: "POST" as const,
  contentType: "application/json" as const,
  authType: "none" as const,
  timeout: 10_000,
};

describe("webhookDeliveryArtifactType", () => {
  it("validates the canonical artifact shape", () => {
    const ok = webhookDeliveryArtifactType.schema.safeParse({
      url: "https://example.com/hook",
      status: 200,
      responseBody: "{}",
    });
    expect(ok.success).toBe(true);
  });

  it("rejects when status is missing", () => {
    const bad = webhookDeliveryArtifactType.schema.safeParse({
      url: "https://example.com/hook",
      responseBody: "{}",
    });
    expect(bad.success).toBe(false);
  });
});

describe("webhook.send", () => {
  it("delivers a payload and emits a webhook.delivery artifact", async () => {
    fetchFixture = setupFetchSequence([
      { body: { id: "msg-42" }, status: 201 },
    ]);
    const result = await webhookSendAction.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: { ...baseConfig, body: '{"x":1}' },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const artifact = result.artifact as {
      url: string;
      status: number;
      externalId?: string;
      responseBody: string;
    };
    expect(artifact.url).toBe("https://example.com/hook");
    expect(artifact.status).toBe(201);
    expect(artifact.externalId).toBe("msg-42");
    expect(result.externalId).toBe("msg-42");
    const call = fetchFixture.calls[0]!;
    expect(call.init.method).toBe("POST");
    expect(call.init.body).toBe('{"x":1}');
    const headers = call.init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("attaches a bearer token to the Authorization header", async () => {
    fetchFixture = setupFetchSequence([{ body: {} }]);
    await webhookSendAction.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: {
        ...baseConfig,
        authType: "bearer",
        bearerToken: "secret-token",
      },
    });
    const headers = fetchFixture.calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret-token");
  });

  it("attaches Basic auth when username and password are set", async () => {
    fetchFixture = setupFetchSequence([{ body: {} }]);
    await webhookSendAction.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: {
        ...baseConfig,
        authType: "basic",
        basicUsername: "alice",
        basicPassword: "wonderland",
      },
    });
    const headers = fetchFixture.calls[0]!.init.headers as Record<string, string>;
    const expected = `Basic ${Buffer.from("alice:wonderland").toString("base64")}`;
    expect(headers.Authorization).toBe(expected);
  });

  it("attaches a custom header when authType is header", async () => {
    fetchFixture = setupFetchSequence([{ body: {} }]);
    await webhookSendAction.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: {
        ...baseConfig,
        authType: "header",
        authHeaderName: "X-API-Key",
        authHeaderValue: "k123",
      },
    });
    const headers = fetchFixture.calls[0]!.init.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("k123");
  });

  it("appends extra custom headers", async () => {
    fetchFixture = setupFetchSequence([{ body: {} }]);
    await webhookSendAction.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: {
        ...baseConfig,
        customHeaders: [
          { name: "X-Source", value: "checkstack" },
          { name: "X-Trace", value: "abc" },
        ],
      },
    });
    const headers = fetchFixture.calls[0]!.init.headers as Record<string, string>;
    expect(headers["X-Source"]).toBe("checkstack");
    expect(headers["X-Trace"]).toBe("abc");
  });

  it("returns a retryable failure when the status matches retryOnStatus", async () => {
    fetchFixture = setupFetchSequence([
      { status: 429, raw: "rate limited", headers: { "Retry-After": "5" } },
    ]);
    const result = await webhookSendAction.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: { ...baseConfig, retryOnStatus: [429, 503] },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.retryAfterMs).toBe(5_000);
    expect(result.error).toMatch(/429/);
  });

  it("defaults retryAfterMs to 30s when Retry-After is missing", async () => {
    fetchFixture = setupFetchSequence([
      { status: 503, raw: "unavailable" },
    ]);
    const result = await webhookSendAction.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: { ...baseConfig, retryOnStatus: [503] },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.retryAfterMs).toBe(30_000);
  });

  it("returns a non-retryable failure for an unmatched 4xx/5xx", async () => {
    fetchFixture = setupFetchSequence([
      { status: 500, raw: "boom" },
    ]);
    const result = await webhookSendAction.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: { ...baseConfig },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/HTTP 500/);
    expect(result.retryAfterMs).toBeUndefined();
  });

  it("classifies network errors as retryable", async () => {
    fetchFixture = setupFetchSequence([
      { throws: new Error("ECONNREFUSED 127.0.0.1") },
    ]);
    const result = await webhookSendAction.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: { ...baseConfig },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.retryAfterMs).toBe(30_000);
  });

  it("does not retry generic non-network errors", async () => {
    fetchFixture = setupFetchSequence([
      { throws: new Error("something else broke") },
    ]);
    const result = await webhookSendAction.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: { ...baseConfig },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.retryAfterMs).toBeUndefined();
  });

  it("returns success without externalId when the response body is not JSON", async () => {
    fetchFixture = setupFetchSequence([
      { status: 200, raw: "ok" },
    ]);
    const result = await webhookSendAction.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: { ...baseConfig },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.externalId).toBeUndefined();
    const artifact = result.artifact as { responseBody: string };
    expect(artifact.responseBody).toBe("ok");
  });

  it("truncates the captured response body to 1000 chars", async () => {
    const big = "x".repeat(5_000);
    fetchFixture = setupFetchSequence([{ status: 200, raw: big }]);
    const result = await webhookSendAction.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: { ...baseConfig },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const artifact = result.artifact as { responseBody: string };
    expect(artifact.responseBody.length).toBe(1_000);
  });
});
