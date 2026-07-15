import { describe, it, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockLogger } from "@checkstack/test-utils-backend";
import type {
  BoundTelemetrySink,
  TelemetryListenerContext,
} from "@checkstack/telemetry-backend";
import type { NormalizedLogRecord } from "@checkstack/telemetry-common";
import {
  SyslogSourceConfigSchema,
  assertSyslogTlsReadable,
  buildSyslogTls,
  startSyslogListener,
  syslogSourceType,
  DEFAULT_SYSLOG_MAX_CONNECTIONS,
  type SyslogSourceConfig,
} from "./source-type";

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** Parse a partial config against the schema (applies defaults). */
function cfg(overrides: Partial<SyslogSourceConfig> & { port: number }): SyslogSourceConfig {
  return SyslogSourceConfigSchema.parse(overrides);
}

/** A bound sink stub that captures every emitted log record. */
function makeSink(): { sink: BoundTelemetrySink; emitted: NormalizedLogRecord[] } {
  const emitted: NormalizedLogRecord[] = [];
  const sink: BoundTelemetrySink = {
    boundSignals: ["logs"],
    async emit(signal, records) {
      if (signal === "logs") {
        // The generic `S` is erased at runtime; the `signal === "logs"` guard
        // guarantees these are log records, but TS cannot narrow the generic.
        for (const record of records) emitted.push(record as NormalizedLogRecord);
      }
      return { accepted: records.length, rejected: 0, bound: signal === "logs" };
    },
  };
  return { sink, emitted };
}

function listenerCtx(
  config: SyslogSourceConfig,
  sink: BoundTelemetrySink,
): TelemetryListenerContext<SyslogSourceConfig> {
  return { config, sink, logger: createMockLogger() };
}

/** Grab a currently-free TCP port by binding :0 and releasing it. */
function freePort(): number {
  const probe = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: { data() {} },
  });
  const port = probe.port;
  probe.stop(true);
  return port;
}

/** Octet-counting frame (RFC 6587): `<byte-length> SP <message>`. */
function octetFrame(message: string): string {
  const len = new TextEncoder().encode(message).length;
  return `${len} ${message}`;
}

/** Open a client, write `payload`, then close after a short flush window. */
async function sendBytes(port: number, payload: string): Promise<void> {
  const socket = await Bun.connect({
    hostname: "127.0.0.1",
    port,
    socket: {
      open(sock) {
        sock.write(payload);
        sock.flush();
      },
      data() {},
      error() {},
      close() {},
    },
  });
  // Give the server a beat to read before we FIN.
  await new Promise((resolve) => setTimeout(resolve, 20));
  socket.end();
}

/** Poll until `predicate` holds or the timeout elapses. */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("waitFor: predicate did not hold within timeout");
}

const SAMPLE =
  '<11>1 2026-07-12T10:00:00.000Z host app 4711 ID1 [sd@1 a="b"] disk failure';

// -----------------------------------------------------------------------------
// config schema
// -----------------------------------------------------------------------------

describe("SyslogSourceConfigSchema", () => {
  it("applies defaults for host and maxConnections", () => {
    const parsed = SyslogSourceConfigSchema.parse({ port: 5514 });
    expect(parsed.host).toBe("0.0.0.0");
    expect(parsed.maxConnections).toBe(DEFAULT_SYSLOG_MAX_CONNECTIONS);
    expect(parsed.tls).toBeUndefined();
  });

  it("rejects an out-of-range port", () => {
    expect(SyslogSourceConfigSchema.safeParse({ port: 0 }).success).toBe(false);
    expect(SyslogSourceConfigSchema.safeParse({ port: 70_000 }).success).toBe(
      false,
    );
    expect(SyslogSourceConfigSchema.safeParse({ port: 1.5 }).success).toBe(false);
  });

  it("rejects maxConnections below 1", () => {
    expect(
      SyslogSourceConfigSchema.safeParse({ port: 514, maxConnections: 0 }).success,
    ).toBe(false);
  });

  it("requires both certPath and keyPath when tls is present", () => {
    expect(
      SyslogSourceConfigSchema.safeParse({
        port: 514,
        tls: { certPath: "/c.pem" },
      }).success,
    ).toBe(false);
    expect(
      SyslogSourceConfigSchema.safeParse({
        port: 514,
        tls: { certPath: "/c.pem", keyPath: "/k.pem" },
      }).success,
    ).toBe(true);
  });

  it("rejects empty tls paths", () => {
    expect(
      SyslogSourceConfigSchema.safeParse({
        port: 514,
        tls: { certPath: "", keyPath: "" },
      }).success,
    ).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// source type shape
// -----------------------------------------------------------------------------

describe("syslogSourceType", () => {
  it("is a logs-only listener source with no pull/webhook/derive", () => {
    expect(syslogSourceType.id).toBe("syslog");
    expect(syslogSourceType.signals).toEqual(["logs"]);
    expect(syslogSourceType.listener).toBeDefined();
    expect(syslogSourceType.pull).toBeUndefined();
    expect(syslogSourceType.webhook).toBeUndefined();
    expect(syslogSourceType.derive).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// TLS construction (construction-level, no handshake)
// -----------------------------------------------------------------------------

describe("buildSyslogTls", () => {
  it("returns undefined for a plain-TCP config", () => {
    expect(buildSyslogTls(cfg({ port: 514 }))).toBeUndefined();
  });

  it("builds Bun.file refs for the configured cert and key paths", () => {
    const tls = buildSyslogTls(
      cfg({ port: 514, tls: { certPath: "/etc/certs/c.pem", keyPath: "/etc/certs/k.pem" } }),
    );
    expect(tls).toBeDefined();
    expect(tls?.cert.name).toBe("/etc/certs/c.pem");
    expect(tls?.key.name).toBe("/etc/certs/k.pem");
  });
});

// -----------------------------------------------------------------------------
// TLS start-time validation (a bad path must FAIL start, not bind silently)
// -----------------------------------------------------------------------------

/** Write a temp cert+key pair (arbitrary non-empty content) and return a cleanup. */
async function writeTempTls(
  { cert = "cert-material", key = "key-material" }: { cert?: string; key?: string } = {},
): Promise<{ certPath: string; keyPath: string; cleanup: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "syslog-tls-"));
  const certPath = join(dir, "cert.pem");
  const keyPath = join(dir, "key.pem");
  await Bun.write(certPath, cert);
  await Bun.write(keyPath, key);
  return { certPath, keyPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Generate a REAL self-signed cert/key pair via openssl, so `Bun.listen` (which
 * parses the PEM at bind) actually accepts it - dummy bytes fail BoringSSL.
 */
async function writeRealTls(): Promise<{
  certPath: string;
  keyPath: string;
  cleanup: () => void;
}> {
  const dir = mkdtempSync(join(tmpdir(), "syslog-tls-real-"));
  const certPath = join(dir, "cert.pem");
  const keyPath = join(dir, "key.pem");
  const proc = Bun.spawnSync([
    "openssl", "req", "-x509", "-newkey", "rsa:2048",
    "-keyout", keyPath, "-out", certPath,
    "-days", "1", "-nodes", "-subj", "/CN=localhost",
  ]);
  if (proc.exitCode !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`openssl failed to generate a test cert: ${proc.stderr.toString()}`);
  }
  return { certPath, keyPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("assertSyslogTlsReadable", () => {
  it("resolves for a readable, non-empty cert/key pair", async () => {
    const { certPath, keyPath, cleanup } = await writeTempTls();
    try {
      await expect(assertSyslogTlsReadable({ certPath, keyPath })).resolves.toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("throws naming the missing cert path", async () => {
    const missing = "/no/such/dir/missing-cert.pem";
    await expect(
      assertSyslogTlsReadable({ certPath: missing, keyPath: missing }),
    ).rejects.toThrow(missing);
  });

  it("throws naming an empty cert file", async () => {
    const { certPath, keyPath, cleanup } = await writeTempTls({ cert: "" });
    try {
      await expect(
        assertSyslogTlsReadable({ certPath, keyPath }),
      ).rejects.toThrow(certPath);
    } finally {
      cleanup();
    }
  });
});

describe("startSyslogListener TLS validation", () => {
  it("rejects with an error naming the path when the cert file does not exist", async () => {
    const port = freePort();
    const { sink } = makeSink();
    const missing = "/no/such/dir/missing-cert.pem";
    await expect(
      startSyslogListener(
        listenerCtx(
          cfg({ port, host: "127.0.0.1", tls: { certPath: missing, keyPath: missing } }),
          sink,
        ),
      ),
    ).rejects.toThrow(missing);
  });

  it("starts with a valid (readable, non-empty) cert/key pair", async () => {
    const { certPath, keyPath, cleanup } = await writeRealTls();
    const port = freePort();
    const { sink } = makeSink();
    try {
      const stop = await startSyslogListener(
        listenerCtx(cfg({ port, host: "127.0.0.1", tls: { certPath, keyPath } }), sink),
      );
      stop();
    } finally {
      cleanup();
    }
  });
});

// -----------------------------------------------------------------------------
// listener lifecycle over a real ephemeral port
// -----------------------------------------------------------------------------

describe("startSyslogListener", () => {
  it("frames LF-delimited lines, parses, and emits mapped records", async () => {
    const port = freePort();
    const { sink, emitted } = makeSink();
    const stop = await startSyslogListener(listenerCtx(cfg({ port, host: "127.0.0.1" }), sink));
    try {
      await sendBytes(port, `${SAMPLE}\n`);
      await waitFor(() => emitted.length >= 1);

      expect(emitted).toHaveLength(1);
      const record = emitted[0]!;
      expect(record.body).toBe("disk failure");
      expect(record.severityNumber).toBe(18); // PRI 11 -> error band midpoint
      expect(record.severityText).toBe("err");
      expect(record.attributes?.["host.name"]).toBe("host");
      expect(record.attributes?.["sd.sd@1.a"]).toBe("b");
    } finally {
      stop();
    }
  });

  it("frames octet-counted messages (RFC 6587)", async () => {
    const port = freePort();
    const { sink, emitted } = makeSink();
    const stop = await startSyslogListener(listenerCtx(cfg({ port, host: "127.0.0.1" }), sink));
    try {
      // Two octet-counted frames back to back on one connection.
      await sendBytes(port, octetFrame(SAMPLE) + octetFrame("<14>1 - h - - - - second"));
      await waitFor(() => emitted.length >= 2);

      expect(emitted).toHaveLength(2);
      expect(emitted[0]!.body).toBe("disk failure");
      expect(emitted[1]!.body).toBe("second");
    } finally {
      stop();
    }
  });

  it("does not emit for an unparseable line (no PRI)", async () => {
    const port = freePort();
    const { sink, emitted } = makeSink();
    const stop = await startSyslogListener(listenerCtx(cfg({ port, host: "127.0.0.1" }), sink));
    try {
      await sendBytes(port, "not a syslog line\n");
      // Give it a moment; nothing should be emitted.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(emitted).toHaveLength(0);
    } finally {
      stop();
    }
  });

  it("throws on a bind failure (port already in use)", async () => {
    const port = freePort();
    const { sink } = makeSink();
    const stop = await startSyslogListener(listenerCtx(cfg({ port, host: "127.0.0.1" }), sink));
    try {
      await expect(
        startSyslogListener(listenerCtx(cfg({ port, host: "127.0.0.1" }), sink)),
      ).rejects.toThrow();
    } finally {
      stop();
    }
  });

  it("stop() closes the socket so the port frees up", async () => {
    const port = freePort();
    const { sink } = makeSink();
    const stop = await startSyslogListener(listenerCtx(cfg({ port, host: "127.0.0.1" }), sink));
    stop();
    // The port is bindable again once stopped (would throw if still held).
    const stop2 = await startSyslogListener(listenerCtx(cfg({ port, host: "127.0.0.1" }), sink));
    stop2();
  });
});
