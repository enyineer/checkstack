import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { probeConnectTiming } from "./connect-probe";

describe("probeConnectTiming", () => {
  let server: net.Server;
  let port = 0;

  beforeAll(async () => {
    server = net.createServer((socket) => socket.end());
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => server.close());

  it("measures TCP connect time to a listening port", async () => {
    const result = await probeConnectTiming({
      ip: "127.0.0.1",
      port,
      tls: false,
      timeoutMs: 2000,
    });
    expect(result.connectMs).toBeGreaterThanOrEqual(0);
    expect(result.tlsMs).toBeUndefined();
  });

  it("never throws on a refused connection (timing-only, best-effort)", async () => {
    // Port the listening server is NOT on; connection is refused.
    const result = await probeConnectTiming({
      ip: "127.0.0.1",
      port: port + 1,
      tls: false,
      timeoutMs: 1000,
    });
    // Resolves to an empty result rather than rejecting - it must never fail
    // the health check.
    expect(result.connectMs).toBeUndefined();
  });
});
