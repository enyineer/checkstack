import { describe, it, expect } from "bun:test";
import { createMockLogger } from "@checkstack/test-utils-backend";
import { createInstanceRuntime } from "@checkstack/backend-api";
import { DEFAULT_LOG_STREAM_CONFIG, SyslogFramer } from "@checkstack/logstream-common";
import type { IngestAuthenticator } from "../auth";
import type { StreamConfigResolver } from "../stream-config";
import type { IngestPipeline } from "../pipeline";
import {
  readSyslogEnvConfig,
  verifyConnectionToken,
  createSyslogListener,
  invalidateConnectionVerdicts,
  SYSLOG_VERDICT_TTL_MS,
  DEFAULT_SYSLOG_MAX_CONNECTIONS,
  type ConnectionState,
  type ConnectionVerdict,
} from "./listener";

function countingAuth(): { auth: IngestAuthenticator; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    auth: {
      verify: async (token) => {
        calls += 1;
        if (token === "ckls_a") return { ok: true, streamId: "sa", tokenId: "ta" };
        if (token === "ckls_b") return { ok: true, streamId: "sb", tokenId: "tb" };
        return { ok: false, reason: "unknown" };
      },
      clearNegative: async () => {},
    },
  };
}

function state(): ConnectionState {
  return { framer: new SyslogFramer() };
}

describe("readSyslogEnvConfig", () => {
  it("returns null when the port is unset", () => {
    expect(readSyslogEnvConfig({})).toBeNull();
  });

  it("defaults maxConnections when unset", () => {
    const config = readSyslogEnvConfig({ CHECKSTACK_LOGSTREAM_SYSLOG_PORT: "5514" });
    expect(config?.maxConnections).toBe(DEFAULT_SYSLOG_MAX_CONNECTIONS);
  });

  it("honors an env-provided maxConnections override", () => {
    const config = readSyslogEnvConfig({
      CHECKSTACK_LOGSTREAM_SYSLOG_PORT: "5514",
      CHECKSTACK_LOGSTREAM_SYSLOG_MAX_CONNECTIONS: "10",
    });
    expect(config?.maxConnections).toBe(10);
  });
});

describe("verifyConnectionToken", () => {
  it("gives two different tokens on one connection distinct verdicts", async () => {
    const { auth, calls } = countingAuth();
    const s = state();
    const v1 = await verifyConnectionToken({ state: s, token: "ckls_a", auth, nowMs: 0 });
    const v2 = await verifyConnectionToken({ state: s, token: "ckls_b", auth, nowMs: 0 });
    expect(v1).toEqual({ ok: true, streamId: "sa", tokenId: "ta" });
    expect(v2).toEqual({ ok: true, streamId: "sb", tokenId: "tb" });
    expect(calls()).toBe(2); // a different token forces a re-verify, never reuse
  });

  it("reuses the cached verdict within the TTL for the same token", async () => {
    const { auth, calls } = countingAuth();
    const s = state();
    await verifyConnectionToken({ state: s, token: "ckls_a", auth, nowMs: 0 });
    await verifyConnectionToken({
      state: s,
      token: "ckls_a",
      auth,
      nowMs: SYSLOG_VERDICT_TTL_MS - 1,
    });
    expect(calls()).toBe(1);
  });

  it("re-verifies after the TTL so a revoke is honored mid-connection", async () => {
    let revoked = false;
    let calls = 0;
    const auth: IngestAuthenticator = {
      verify: async () => {
        calls += 1;
        return revoked
          ? { ok: false, reason: "revoked" }
          : { ok: true, streamId: "s", tokenId: "t" };
      },
      clearNegative: async () => {},
    };
    const s = state();

    const first = await verifyConnectionToken({ state: s, token: "ckls_a", auth, nowMs: 0 });
    expect(first.ok).toBe(true);

    revoked = true;
    const within = await verifyConnectionToken({
      state: s,
      token: "ckls_a",
      auth,
      nowMs: SYSLOG_VERDICT_TTL_MS - 1,
    });
    expect(within.ok).toBe(true); // still trusted within the TTL

    const after = await verifyConnectionToken({
      state: s,
      token: "ckls_a",
      auth,
      nowMs: SYSLOG_VERDICT_TTL_MS + 1,
    });
    expect(after.ok).toBe(false); // re-checked; revoke now honored
    expect(calls).toBe(2);
  });
});

describe("createSyslogListener", () => {
  const pipeline = {
    ingest: () => ({ accepted: 0, rejectedRateLimit: 0, rejectedBuffer: 0, retryAfterSeconds: 0 }),
    flushNow: async () => {},
    start: () => {},
    stop: () => {},
    // Test mock: only the shape the listener touches; cast to the full type.
  } as unknown as IngestPipeline;

  const configResolver: StreamConfigResolver = {
    resolve: async () => DEFAULT_LOG_STREAM_CONFIG,
  };

  it("start() no-ops on a secondary (non-default) instance", () => {
    const logger = createMockLogger();
    const listener = createSyslogListener({
      config: {
        port: 5514,
        hostname: "0.0.0.0",
        maxConnections: DEFAULT_SYSLOG_MAX_CONNECTIONS,
      },
      auth: countingAuth().auth,
      configResolver,
      pipeline,
      logger,
      instanceRuntime: createInstanceRuntime({ namespace: "preview" }),
    });

    // Must not throw and must not bind a socket; stop() is safe afterwards.
    expect(() => {
      listener.start();
      listener.stop();
    }).not.toThrow();
  });
});

describe("invalidateConnectionVerdicts", () => {
  function state(verdict?: ConnectionVerdict): ConnectionState {
    return {
      framer: new SyslogFramer(),
      cachedToken: verdict ? "ckls_x_y" : undefined,
      cachedVerdict: verdict,
      verdictAtMs: verdict ? 1000 : undefined,
    };
  }

  it("evicts positive verdicts for exactly the given token ids", () => {
    const hit = state({ ok: true, streamId: "s1", tokenId: "tok-a" });
    const other = state({ ok: true, streamId: "s2", tokenId: "tok-b" });
    const negative = state({ ok: false });

    const evicted = invalidateConnectionVerdicts({
      states: [hit, other, negative],
      tokenIds: ["tok-a"],
    });

    expect(evicted).toBe(1);
    expect(hit.cachedVerdict).toBeUndefined();
    expect(hit.cachedToken).toBeUndefined();
    expect(hit.verdictAtMs).toBeUndefined();
    // Unrelated token and negative verdicts stay untouched.
    expect(other.cachedVerdict).toEqual({ ok: true, streamId: "s2", tokenId: "tok-b" });
    expect(negative.cachedVerdict).toEqual({ ok: false });
  });

  it("evicts negative verdicts when negatives is set (token minted)", () => {
    const negative = state({ ok: false });
    const positive = state({ ok: true, streamId: "s1", tokenId: "tok-a" });

    const evicted = invalidateConnectionVerdicts({
      states: [negative, positive],
      negatives: true,
    });

    expect(evicted).toBe(1);
    expect(negative.cachedVerdict).toBeUndefined();
    expect(positive.cachedVerdict).toEqual({
      ok: true,
      streamId: "s1",
      tokenId: "tok-a",
    });
  });

  it("an evicted connection re-verifies on its next frame", async () => {
    const s = state({ ok: true, streamId: "s1", tokenId: "tok-a" });
    invalidateConnectionVerdicts({ states: [s], tokenIds: ["tok-a"] });

    let verifies = 0;
    const auth: IngestAuthenticator = {
      verify: async () => {
        verifies += 1;
        return { ok: false, reason: "revoked" };
      },
    };
    const verdict = await verifyConnectionToken({
      state: s,
      token: "ckls_x_y",
      auth,
      nowMs: 1500, // well within what WAS the verdict TTL
    });
    expect(verifies).toBe(1); // cache gone, so verify ran despite freshness
    expect(verdict).toEqual({ ok: false });
  });
});
