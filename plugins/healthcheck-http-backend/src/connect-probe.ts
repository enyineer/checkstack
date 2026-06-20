import net from "node:net";
import tls from "node:tls";

/**
 * Best-effort TCP/TLS connect timing for the HTTP timing breakdown.
 *
 * Why a separate probe: the actual request goes through `fetch`, whose internal
 * socket does NOT expose connect/handshake events on the Bun runtime (Bun never
 * emits `connect`/`secureConnect` on `node:http` sockets). Raw `node:net` /
 * `node:tls` sockets DO emit them on Bun, so we open one short-lived connection
 * to the SAME already-validated IP purely to measure how long TCP connect and
 * the TLS handshake take. It is representative (same host/IP/network, run
 * alongside the request), not the request's own socket.
 *
 * This is timing-only and MUST NEVER fail the check: any error / timeout
 * resolves to whatever was measured so far (possibly nothing). The socket is
 * destroyed as soon as the handshake completes - no application bytes are sent.
 */
export interface ConnectProbeResult {
  /** TCP connect duration in ms (from probe start to the `connect` event). */
  connectMs?: number;
  /** TLS handshake duration in ms (`connect` -> `secureConnect`); https only. */
  tlsMs?: number;
}

export interface ConnectProbeOptions {
  /** The pre-validated IP literal to connect to (no DNS, no SSRF re-resolve). */
  ip: string;
  port: number;
  /** Whether to perform a TLS handshake (https targets). */
  tls: boolean;
  /** SNI server name for the TLS handshake (the original hostname). */
  servername?: string;
  /** Abort the probe after this many ms. */
  timeoutMs: number;
  /** Monotonic clock; injectable for tests. Defaults to `performance.now`. */
  now?: () => number;
}

export function probeConnectTiming({
  ip,
  port,
  tls: useTls,
  servername,
  timeoutMs,
  now = () => performance.now(),
}: ConnectProbeOptions): Promise<ConnectProbeResult> {
  return new Promise<ConnectProbeResult>((resolve) => {
    const result: ConnectProbeResult = {};
    const start = now();
    let settled = false;

    const finish = (socket: net.Socket): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    if (useTls) {
      const socket = tls.connect({
        host: ip,
        port,
        ...(servername === undefined ? {} : { servername }),
        // Timing only - the real `fetch` validates the certificate. We just
        // want the handshake duration, so a cert mismatch must not abort it.
        rejectUnauthorized: false,
      });
      socket.once("connect", () => {
        result.connectMs = Math.max(0, now() - start);
      });
      socket.once("secureConnect", () => {
        const handshakeDone = now() - start;
        result.tlsMs = Math.max(0, handshakeDone - (result.connectMs ?? 0));
        finish(socket);
      });
      socket.once("error", () => finish(socket));
      socket.setTimeout(timeoutMs, () => finish(socket));
    } else {
      const socket = net.connect({ host: ip, port }, () => {
        result.connectMs = Math.max(0, now() - start);
        finish(socket);
      });
      socket.once("error", () => finish(socket));
      socket.setTimeout(timeoutMs, () => finish(socket));
    }
  });
}
