/**
 * SSRF guards for the `ai.probeUrl` tool. The probe issues an outbound HTTP
 * request FROM THE CORE BACKEND, so it must never be steerable at internal
 * services, the loopback interface, or the cloud metadata endpoint. These pure
 * helpers (URL shape + IP-range classification) are unit-tested; the network
 * call itself lives in `probe-url.ts` and uses them to validate the URL AND
 * every DNS-resolved IP before connecting.
 */

/** Max response body we read from a probe (avoid memory blow-ups). */
export const PROBE_MAX_BODY_BYTES = 256 * 1024;
/** Probe request timeout. */
export const PROBE_TIMEOUT_MS = 5000;

/** Hostnames that must never be probed regardless of DNS. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
]);

/**
 * Classify an IPv4 literal as private/reserved (must be blocked). Covers the
 * ranges an SSRF would target: loopback, RFC1918, link-local (incl. the cloud
 * metadata 169.254.169.254), CGNAT, "this host", and broadcast.
 */
function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map(Number);
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return false;
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 + 192.0.2.0/24 (test nets)
  if (a >= 224) return true; // multicast + reserved/broadcast
  return false;
}

/**
 * Classify an IPv6 literal as private/reserved. Handles loopback, ULA, link-
 * local, unspecified, and IPv4-mapped/embedded addresses (which would otherwise
 * smuggle a private IPv4 past an IPv6 check).
 */
function isPrivateIpv6(ip: string): boolean {
  const addr = ip.toLowerCase().split("%")[0]; // strip zone id
  if (addr === "::1" || addr === "::") return true; // loopback / unspecified
  // IPv4-mapped (::ffff:a.b.c.d) or IPv4-compatible: validate the embedded v4.
  const v4Match = addr.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4Match && isPrivateIpv4(v4Match[1])) return true;
  const head = addr.split(":")[0];
  if (head.startsWith("fc") || head.startsWith("fd")) return true; // fc00::/7 ULA
  if (head.startsWith("fe8") || head.startsWith("fe9") || head.startsWith("fea") || head.startsWith("feb")) {
    return true; // fe80::/10 link-local
  }
  return false;
}

/** True when an IP literal is private/reserved and must NOT be probed. */
export function isPrivateIp(ip: string): boolean {
  return ip.includes(":") ? isPrivateIpv6(ip) : isPrivateIpv4(ip);
}

/** The validated, safe-to-fetch parse of a probe URL. */
export interface SafeProbeUrl {
  url: URL;
  hostname: string;
}

/**
 * Validate a probe URL's SHAPE (before DNS): it must be a well-formed http(s)
 * URL, not a blocked hostname, and not an IP literal in a private range. Throws
 * with a clear message on rejection. DNS-resolved IPs are checked separately at
 * fetch time via {@link isPrivateIp} (this catches a hostname that resolves to
 * a private IP, which the shape check cannot see).
 */
export function parseSafeProbeUrl(raw: string): SafeProbeUrl {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: "${raw}".`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `Only http and https URLs can be probed (got "${url.protocol}").`,
    );
  }
  const hostname = url.hostname.replaceAll(/^\[|\]$/g, "").toLowerCase(); // unwrap [::1]
  if (!hostname) {
    throw new Error("URL has no host.");
  }
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost")) {
    throw new Error(`Refusing to probe a loopback/internal host: "${hostname}".`);
  }
  // If the host is an IP literal, reject private ranges up front.
  const looksLikeIp = /^[\d.]+$/.test(hostname) || hostname.includes(":");
  if (looksLikeIp && isPrivateIp(hostname)) {
    throw new Error(
      `Refusing to probe a private/reserved address: "${hostname}".`,
    );
  }
  return { url, hostname };
}
