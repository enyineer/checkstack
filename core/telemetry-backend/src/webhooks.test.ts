import { describe, it, expect } from "bun:test";
import { createHmac } from "node:crypto";
import { z } from "zod";
import type { Logger } from "@checkstack/backend-api";
import { createMockLogger } from "@checkstack/test-utils-backend";
import { createSourceTokenKit, RateLimiter } from "@checkstack/ingest-utils";
import {
  createWebhookHandler,
  extractSourceId,
  webhookPath,
  type WebhookSourceRow,
} from "./webhooks";
import {
  createTelemetrySourceRegistry,
  defineTelemetrySourceType,
  type TelemetrySinkRegistry,
  type TelemetrySourceRegistry,
} from "./extension-points";

const kit = createSourceTokenKit({ prefix: "ckwh_" });

let lastHandled: { config: unknown; body: string } | null = null;

function registry(): TelemetrySourceRegistry {
  const r = createTelemetrySourceRegistry();
  const handle = async (ctx: { config: unknown }, request: Request) => {
    lastHandled = { config: ctx.config, body: await request.text() };
    return new Response("accepted", { status: 202 });
  };
  r.register(
    defineTelemetrySourceType({
      id: "hook",
      displayName: "Hook",
      description: "",
      signals: ["logs"],
      configSchema: z.object({}),
      webhook: { handle },
    }),
    { pluginId: "p" },
  );
  r.register(
    defineTelemetrySourceType({
      id: "pullonly",
      displayName: "Pull only",
      description: "",
      signals: ["logs"],
      configSchema: z.object({}),
      pull: { defaultIntervalSeconds: 60, minIntervalSeconds: 30, execute: async () => {} },
    }),
    { pluginId: "p" },
  );
  // GitHub-style: HMAC-SHA256, hex, `sha256=` prefix, over the raw body.
  r.register(
    defineTelemetrySourceType({
      id: "ghhook",
      displayName: "GitHub hook",
      description: "",
      signals: ["logs"],
      configSchema: z.object({}),
      webhook: {
        handle,
        signature: {
          algorithm: "hmac-sha256",
          header: "x-hub-signature-256",
          encoding: "hex",
          prefix: "sha256=",
          basestring: "body",
        },
      },
    }),
    { pluginId: "p" },
  );
  // Slack-style: HMAC-SHA256, hex, `v0=` prefix, over `v0:<ts>:<body>`.
  r.register(
    defineTelemetrySourceType({
      id: "slackhook",
      displayName: "Slack hook",
      description: "",
      signals: ["logs"],
      configSchema: z.object({}),
      webhook: {
        handle,
        signature: {
          algorithm: "hmac-sha256",
          header: "x-slack-signature",
          encoding: "hex",
          prefix: "v0=",
          basestring: "versioned-timestamp-body",
          timestampHeader: "x-slack-request-timestamp",
          toleranceSeconds: 300,
        },
      },
    }),
    { pluginId: "p" },
  );
  // Base64 encoding path: HMAC-SHA256, base64, no prefix, over the raw body.
  r.register(
    defineTelemetrySourceType({
      id: "b64hook",
      displayName: "Base64 hook",
      description: "",
      signals: ["logs"],
      configSchema: z.object({}),
      webhook: {
        handle,
        signature: {
          algorithm: "hmac-sha256",
          header: "x-signature",
          encoding: "base64",
          basestring: "body",
        },
      },
    }),
    { pluginId: "p" },
  );
  return r;
}

/** The raw HMAC key the fake store resolves for every signature-typed source. */
const HMAC_KEY = "ckwh_src1_super-secret-key-value";

const emptySinks: TelemetrySinkRegistry = {
  register: () => {},
  get: () => undefined,
  list: () => [],
};

function makeHandler(
  row: WebhookSourceRow | null,
  opts: {
    rateLimiter?: RateLimiter;
    limitPerMinute?: number;
    webhookSecret?: string | undefined;
    maxBodyBytes?: number;
    now?: () => Date;
    logger?: Logger;
    unverifiableCalls?: Array<{ sourceId: string; message: string }>;
  } = {},
) {
  lastHandled = null;
  const unverifiableCalls = opts.unverifiableCalls;
  return createWebhookHandler({
    loadSource: async () => row,
    sourceRegistry: registry(),
    sinkRegistry: emptySinks,
    resolveRunnableConfig: async ({ config }) => config,
    webhookKit: kit,
    resolveWebhookSecret: async () =>
      "webhookSecret" in opts ? opts.webhookSecret : HMAC_KEY,
    markSignatureUnverifiable: async (input) => {
      unverifiableCalls?.push(input);
    },
    rateLimiter: opts.rateLimiter ?? new RateLimiter(),
    ...(opts.limitPerMinute === undefined
      ? {}
      : { limitPerMinute: opts.limitPerMinute }),
    ...(opts.maxBodyBytes === undefined
      ? {}
      : { maxBodyBytes: opts.maxBodyBytes }),
    ...(opts.now === undefined ? {} : { now: opts.now }),
    logger: opts.logger ?? createMockLogger(),
  });
}

const secret = "ckwh_abc_secret-value";
const goodRow: WebhookSourceRow = {
  id: "src-1",
  sourceTypeId: "p.hook",
  config: { foo: "bar" },
  bindings: [{ signal: "logs", streamId: "stream-1" }],
  enabled: true,
  webhookSecretHash: kit.hashToken(secret),
};

function post(headers: Record<string, string> = {}): Request {
  return new Request(`https://host${webhookPath("src-1")}`, {
    method: "POST",
    headers,
  });
}

function postBody(body: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://host${webhookPath("src-1")}`, {
    method: "POST",
    headers,
    body,
  });
}

/** A signature-typed row (secret hash present but unused for HMAC types). */
function sigRow(sourceTypeId: string): WebhookSourceRow {
  return { ...goodRow, sourceTypeId };
}

/** hex HMAC of `base` under {@link HMAC_KEY}. */
function hmacHex(algorithm: "sha256" | "sha1", base: string): string {
  return createHmac(algorithm, HMAC_KEY).update(base).digest("hex");
}

/** base64 HMAC of `base` under {@link HMAC_KEY}. */
function hmacBase64(base: string): string {
  return createHmac("sha256", HMAC_KEY).update(base).digest("base64");
}

describe("extractSourceId", () => {
  it("parses the trailing id segment", () => {
    expect(extractSourceId(`https://host${webhookPath("src-1")}`)).toBe("src-1");
  });
  it("rejects nested paths and non-matching urls", () => {
    expect(extractSourceId("https://host/api/telemetry/hooks/a/b")).toBeNull();
    expect(extractSourceId("https://host/api/other")).toBeNull();
  });
  it("returns null for a malformed percent-escape instead of throwing", () => {
    expect(extractSourceId("https://host/api/telemetry/hooks/%zz")).toBeNull();
  });
});

describe("webhook handler", () => {
  it("invokes handle on a correct Bearer secret", async () => {
    const res = await makeHandler(goodRow)(
      post({ authorization: `Bearer ${secret}` }),
    );
    expect(res.status).toBe(202);
    expect(lastHandled?.config).toEqual({ foo: "bar" });
  });

  it("accepts the X-Checkstack-Webhook-Secret header", async () => {
    const res = await makeHandler(goodRow)(
      post({ "x-checkstack-webhook-secret": secret }),
    );
    expect(res.status).toBe(202);
  });

  it("rejects a wrong secret with 401", async () => {
    const res = await makeHandler(goodRow)(
      post({ authorization: "Bearer ckwh_abc_wrong" }),
    );
    expect(res.status).toBe(401);
    expect(lastHandled).toBeNull();
  });

  it("rejects a missing secret with 401", async () => {
    const res = await makeHandler(goodRow)(post());
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown source", async () => {
    const res = await makeHandler(null)(post({ authorization: `Bearer ${secret}` }));
    expect(res.status).toBe(404);
  });

  it("returns 404 for a disabled source", async () => {
    const res = await makeHandler({ ...goodRow, enabled: false })(
      post({ authorization: `Bearer ${secret}` }),
    );
    expect(res.status).toBe(404);
  });

  it("returns 405 for a type without a webhook seam", async () => {
    const res = await makeHandler({ ...goodRow, sourceTypeId: "p.pullonly" })(
      post({ authorization: `Bearer ${secret}` }),
    );
    expect(res.status).toBe(405);
  });

  it("returns 405 for a non-POST method", async () => {
    const res = await makeHandler(goodRow)(
      new Request(`https://host${webhookPath("src-1")}`, { method: "GET" }),
    );
    expect(res.status).toBe(405);
  });

  it("rate-limits per instance with 429 + Retry-After once the budget is spent", async () => {
    const handler = makeHandler(goodRow, { limitPerMinute: 2 });
    const ok1 = await handler(post({ authorization: `Bearer ${secret}` }));
    const ok2 = await handler(post({ authorization: `Bearer ${secret}` }));
    expect(ok1.status).toBe(202);
    expect(ok2.status).toBe(202);
    const limited = await handler(post({ authorization: `Bearer ${secret}` }));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("a rotated secret invalidates the old one", async () => {
    // The stored hash now reflects a NEW secret; the old secret must 401.
    const rotated = kit.generateToken({ resourceId: "src-1" });
    const handler = makeHandler({ ...goodRow, webhookSecretHash: rotated.tokenHash });
    expect(
      (await handler(post({ authorization: `Bearer ${secret}` }))).status,
    ).toBe(401);
    expect(
      (await handler(post({ authorization: `Bearer ${rotated.secret}` }))).status,
    ).toBe(202);
  });
});

describe("webhook HMAC signature verification", () => {
  const body = JSON.stringify({ event: "push", n: 1 });

  describe("GitHub-style (hmac-sha256, hex, sha256= over body)", () => {
    it("accepts a valid signature and forwards the buffered body", async () => {
      const sig = `sha256=${hmacHex("sha256", body)}`;
      const res = await makeHandler(sigRow("p.ghhook"))(
        postBody(body, { "x-hub-signature-256": sig }),
      );
      expect(res.status).toBe(202);
      // handle() must still be able to read the body after verification buffered it.
      expect(lastHandled?.body).toBe(body);
    });

    it("rejects a wrong signature with 401", async () => {
      const sig = `sha256=${hmacHex("sha256", "tampered")}`;
      const res = await makeHandler(sigRow("p.ghhook"))(
        postBody(body, { "x-hub-signature-256": sig }),
      );
      expect(res.status).toBe(401);
      expect(lastHandled).toBeNull();
    });

    it("rejects a wrong-length signature with 401", async () => {
      const sig = `sha256=${hmacHex("sha256", body).slice(0, 30)}`;
      const res = await makeHandler(sigRow("p.ghhook"))(
        postBody(body, { "x-hub-signature-256": sig }),
      );
      expect(res.status).toBe(401);
    });

    it("rejects a missing signature header with 401", async () => {
      const res = await makeHandler(sigRow("p.ghhook"))(postBody(body));
      expect(res.status).toBe(401);
    });

    it("rejects a signature missing the declared prefix with 401", async () => {
      // Correct digest but no `sha256=` prefix -> malformed.
      const res = await makeHandler(sigRow("p.ghhook"))(
        postBody(body, { "x-hub-signature-256": hmacHex("sha256", body) }),
      );
      expect(res.status).toBe(401);
    });

    it("does NOT accept the plain bearer secret on a signature type", async () => {
      const res = await makeHandler(sigRow("p.ghhook"))(
        postBody(body, { authorization: `Bearer ${secret}` }),
      );
      expect(res.status).toBe(401);
    });

    it("fails closed (401) when no HMAC key is stored", async () => {
      const sig = `sha256=${hmacHex("sha256", body)}`;
      const res = await makeHandler(sigRow("p.ghhook"), {
        webhookSecret: undefined,
      })(postBody(body, { "x-hub-signature-256": sig }));
      expect(res.status).toBe(401);
    });
  });

  describe("Slack-style (versioned v0:<ts>:<body>, 300s tolerance)", () => {
    const now = new Date("2026-07-14T00:00:00Z");
    const nowSeconds = Math.floor(now.getTime() / 1000);

    function slackReq(ts: number): Request {
      const sig = `v0=${hmacHex("sha256", `v0:${ts}:${body}`)}`;
      return postBody(body, {
        "x-slack-signature": sig,
        "x-slack-request-timestamp": String(ts),
      });
    }

    it("accepts a fresh versioned signature", async () => {
      const res = await makeHandler(sigRow("p.slackhook"), {
        now: () => now,
      })(slackReq(nowSeconds));
      expect(res.status).toBe(202);
    });

    it("rejects a stale timestamp beyond tolerance with 401", async () => {
      const res = await makeHandler(sigRow("p.slackhook"), {
        now: () => now,
      })(slackReq(nowSeconds - 301));
      expect(res.status).toBe(401);
    });

    it("rejects a future timestamp beyond tolerance with 401", async () => {
      const res = await makeHandler(sigRow("p.slackhook"), {
        now: () => now,
      })(slackReq(nowSeconds + 301));
      expect(res.status).toBe(401);
    });

    it("rejects a valid digest for a DIFFERENT timestamp than the header", async () => {
      // Signature computed over nowSeconds, but the timestamp header claims a
      // stale ts -> the recomputed base string differs, so it must 401.
      const sig = `v0=${hmacHex("sha256", `v0:${nowSeconds}:${body}`)}`;
      const res = await makeHandler(sigRow("p.slackhook"), {
        now: () => now,
      })(
        postBody(body, {
          "x-slack-signature": sig,
          "x-slack-request-timestamp": String(nowSeconds - 10),
        }),
      );
      expect(res.status).toBe(401);
    });
  });

  describe("base64 encoding path", () => {
    it("accepts a valid base64 signature", async () => {
      const res = await makeHandler(sigRow("p.b64hook"))(
        postBody(body, { "x-signature": hmacBase64(body) }),
      );
      expect(res.status).toBe(202);
    });

    it("rejects a wrong base64 signature with 401", async () => {
      const res = await makeHandler(sigRow("p.b64hook"))(
        postBody(body, { "x-signature": hmacBase64("tampered") }),
      );
      expect(res.status).toBe(401);
    });
  });

  describe("missing HMAC key (break-until-rotate)", () => {
    it("401s, warns once, and persists lastError once across two deliveries", async () => {
      const logger = createMockLogger();
      const unverifiableCalls: Array<{ sourceId: string; message: string }> = [];
      const handler = makeHandler(sigRow("p.ghhook"), {
        webhookSecret: undefined,
        logger,
        unverifiableCalls,
      });
      const sig = `sha256=${hmacHex("sha256", body)}`;

      const first = await handler(postBody(body, { "x-hub-signature-256": sig }));
      const second = await handler(postBody(body, { "x-hub-signature-256": sig }));

      expect(first.status).toBe(401);
      expect(second.status).toBe(401);
      // Warn + persist fire exactly once per source per process, not per delivery.
      expect(logger.warn.mock.calls.length).toBe(1);
      expect(unverifiableCalls.length).toBe(1);
      expect(unverifiableCalls[0]!.sourceId).toBe("src-1");
      expect(unverifiableCalls[0]!.message).toContain(
        "Rotate the webhook secret",
      );
    });
  });

  describe("malformed source id", () => {
    it("returns 404 (not 500) for a malformed percent-escape in the path", async () => {
      const res = await makeHandler(goodRow)(
        new Request("https://host/api/telemetry/hooks/%zz", { method: "POST" }),
      );
      expect(res.status).toBe(404);
    });
  });
});

describe("webhook body size cap (pre-auth)", () => {
  const body = JSON.stringify({ event: "push", n: 1 });

  /** POST a stream body of `bytes` zero-bytes (no content-length is set). */
  function streamPost(bytes: number, headers: Record<string, string>): Request {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(bytes));
        controller.close();
      },
    });
    return new Request(`https://host${webhookPath("src-1")}`, {
      method: "POST",
      headers,
      body: stream,
    });
  }

  it("rejects an oversized declared content-length with 413 before verifying", async () => {
    const res = await makeHandler(sigRow("p.ghhook"), { maxBodyBytes: 16 })(
      // "x".repeat(100) gives an honest content-length of 100 > 16.
      postBody("x".repeat(100), { "x-hub-signature-256": "sha256=deadbeef" }),
    );
    expect(res.status).toBe(413);
    expect(lastHandled).toBeNull();
  });

  it("rejects a lying/absent content-length by capping the stream read (413)", async () => {
    const res = await makeHandler(sigRow("p.ghhook"), { maxBodyBytes: 16 })(
      streamPost(100, { "x-hub-signature-256": "sha256=deadbeef" }),
    );
    expect(res.status).toBe(413);
    expect(lastHandled).toBeNull();
  });

  it("still verifies a normal-size body under the cap", async () => {
    const sig = `sha256=${hmacHex("sha256", body)}`;
    const res = await makeHandler(sigRow("p.ghhook"), { maxBodyBytes: 1024 })(
      postBody(body, { "x-hub-signature-256": sig }),
    );
    expect(res.status).toBe(202);
    expect(lastHandled?.body).toBe(body);
  });
});
