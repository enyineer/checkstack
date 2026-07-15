import { describe, it, expect } from "bun:test";
import type { CachedScope } from "@checkstack/cache-utils";
import { createPushTokenLookup } from "@checkstack/telemetry-backend";
import { generateToken } from "../../token-crypto";
import { createIngestAuthenticator } from "../auth";
import { authenticateRequest } from "../endpoints/authenticate";
import { PreAuthRateLimiter } from "../rate-limit";
import { LOGSTREAM_PUSH_SOURCE_TYPE_ID } from "./source-type";
import { createStubPushVerifier, type StubPushSource } from "./stub-verifier";

/** Minimal in-memory {@link CachedScope} exposing the provider the authenticator uses. */
function memoryCache(): CachedScope {
  const store = new Map<string, unknown>();
  const provider = {
    get: async <T>(key: string): Promise<T | undefined> =>
      store.get(key) as T | undefined,
    set: async (key: string, value: unknown) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    deleteByPrefix: async () => 0,
    has: async (key: string) => store.has(key),
  };
  return { provider } as unknown as CachedScope;
}

/**
 * End-to-end verify-path parity: a `ckls_` push token resolves through the
 * PLATFORM's push-token lookup (over a promoted-style `telemetry_sources` row,
 * played by {@link createStubPushVerifier}) exactly as the old
 * `log_stream_tokens` lookup did - through the SAME `createIngestAuthenticator`
 * and the SAME `authenticateRequest` the OTLP/native endpoints call. A valid
 * token verifies to its bound stream; a disabled instance is `revoked`; an
 * unknown/foreign-type token is `unknown`.
 */

function buildAuth(sources: StubPushSource[]) {
  const verifier = createStubPushVerifier({ sources });
  const auth = createIngestAuthenticator({
    lookup: createPushTokenLookup({
      verifier,
      sourceTypeId: LOGSTREAM_PUSH_SOURCE_TYPE_ID,
      signal: "logs",
    }),
    cache: memoryCache(),
  });
  return { auth, verifier };
}

function bearerRequest(secret: string): Request {
  return new Request("http://localhost/api/logstream/v1/logs", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
}

describe("push verify path", () => {
  it("accepts a valid promoted-style token and resolves its bound stream", async () => {
    const token = generateToken({ streamId: "stream-1" });
    const { auth } = buildAuth([
      { sourceId: "src-1", streamId: "stream-1", tokenHash: token.tokenHash },
    ]);

    const result = await authenticateRequest({
      request: bearerRequest(token.secret),
      auth,
      preAuthLimiter: new PreAuthRateLimiter(),
    });

    // The endpoint's admitted-source shape: the bound stream + the source id
    // (which the pipeline later stamps via recordPushSeen).
    expect(result).toEqual({ streamId: "stream-1", tokenId: "src-1" });
  });

  it("rejects a disabled instance as revoked (401)", async () => {
    const token = generateToken({ streamId: "stream-1" });
    const { auth } = buildAuth([
      {
        sourceId: "src-1",
        streamId: "stream-1",
        tokenHash: token.tokenHash,
        enabled: false,
      },
    ]);

    const result = await authenticateRequest({
      request: bearerRequest(token.secret),
      auth,
      preAuthLimiter: new PreAuthRateLimiter(),
    });

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
    expect(await (result as Response).text()).toContain("revoked");
  });

  it("rejects an unknown token as unknown (401)", async () => {
    const { auth } = buildAuth([]);

    const result = await authenticateRequest({
      request: bearerRequest("ckls_unknown_secret"),
      auth,
      preAuthLimiter: new PreAuthRateLimiter(),
    });

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
    expect(await (result as Response).text()).toContain("unknown token");
  });

  it("type-scopes: a token of a foreign push type reads as unknown", async () => {
    const token = generateToken({ streamId: "stream-1" });
    // The verifier only knows a source of a DIFFERENT source type, so the
    // logstream-scoped lookup never resolves the hash.
    const verifier = createStubPushVerifier({
      sources: [
        { sourceId: "src-1", streamId: "stream-1", tokenHash: token.tokenHash },
      ],
      sourceTypeId: "metricstream.push",
    });
    const auth = createIngestAuthenticator({
      lookup: createPushTokenLookup({
        verifier,
        sourceTypeId: LOGSTREAM_PUSH_SOURCE_TYPE_ID,
        signal: "logs",
      }),
      cache: memoryCache(),
    });

    const result = await authenticateRequest({
      request: bearerRequest(token.secret),
      auth,
      preAuthLimiter: new PreAuthRateLimiter(),
    });

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });
});
