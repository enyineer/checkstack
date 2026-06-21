/**
 * SSRF guard for in-process HTTP egress (e.g. the HTTP healthcheck collector
 * running on the trusted core, not in the kernel-isolated script sandbox).
 *
 * Monitoring is legitimately allowed to probe internal/RFC1918 hosts, so this
 * is NOT a blanket internal-network block. It is a SECURE DEFAULT that denies
 * the high-value cloud-metadata + link-local ranges (the same
 * `ALWAYS_BLOCKED_CIDRS` the sandbox enforces) and is operator-extensible.
 *
 * Two properties matter:
 *
 *  1. We resolve the target host to IP(s) and check the CONNECTED IP, not just
 *     the hostname, so a name that resolves to a blocked range is rejected.
 *  2. We resist DNS-rebind by pinning the request to the exact IP we validated:
 *     the URL host is rewritten to the validated IP literal while the original
 *     `Host` header (and TLS SNI for https) is preserved. The connection can no
 *     longer be re-pointed to a different IP between our check and the connect.
 *
 * IP/CIDR matching only (no DNS-name allowlisting) - the same scope as the
 * sandbox's v1 egress filter.
 *
 * @module
 */

import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { ALWAYS_BLOCKED_CIDRS } from "./script-sandbox/network";

/**
 * The default egress denylist for the in-process HTTP collector: exactly the
 * cloud-metadata + link-local ranges. RFC1918 / internal probing stays ALLOWED
 * by default (a monitoring tool's job). Operators extend this via config.
 */
export const DEFAULT_EGRESS_DENY_CIDRS: readonly string[] = ALWAYS_BLOCKED_CIDRS;

/** Error thrown when a target resolves to a denied egress destination. */
export class SsrfBlockedError extends Error {
  constructor(
    readonly host: string,
    readonly blockedIp: string,
    readonly cidr: string,
  ) {
    super(
      `Refusing to connect to ${host}: resolved IP ${blockedIp} is in the ` +
        `denied egress range ${cidr} (cloud-metadata/link-local by default).`,
    );
    this.name = "SsrfBlockedError";
  }
}

// ---------------------------------------------------------------------------
// CIDR matching (pure, dependency-free, IPv4 + IPv6)
// ---------------------------------------------------------------------------

interface ParsedCidr {
  /** Big-integer form of the network address. */
  network: bigint;
  /** Prefix length in bits. */
  prefix: number;
  /** 4 (IPv4) or 6 (IPv6). */
  version: 4 | 6;
}

/** Expand an IPv4 dotted-quad into a 32-bit bigint, or null if malformed. */
function ipv4ToBigInt(ip: string): bigint | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

/** Split one side of a `::`-compressed IPv6 string into hextet groups. */
function expandIpv6Side(side: string): string[] {
  if (side === "") return [];
  return side.split(":");
}

const IPV6_GROUP_MASK = 0xFF_FFn;

/**
 * Expand an IPv6 address (including `::` compression and embedded IPv4) into a
 * 128-bit bigint, or null if malformed.
 */
function ipv6ToBigInt(ip: string): bigint | null {
  // Split off a zone id (`fe80::1%eth0`) if present.
  const zoneless = ip.split("%")[0];
  const halves = zoneless.split("::");
  if (halves.length > 2) return null;

  let head = expandIpv6Side(halves[0] ?? "");
  let tail = halves.length === 2 ? expandIpv6Side(halves[1] ?? "") : [];

  // Handle an embedded IPv4 tail (e.g. ::ffff:1.2.3.4).
  const embedded = (tail.length > 0 ? tail : head).at(-1);
  if (embedded !== undefined && embedded.includes(".")) {
    const v4 = ipv4ToBigInt(embedded);
    if (v4 === null) return null;
    const hi = (v4 >> 16n) & IPV6_GROUP_MASK;
    const lo = v4 & IPV6_GROUP_MASK;
    const replacement = [hi.toString(16), lo.toString(16)];
    if (tail.length > 0) tail = [...tail.slice(0, -1), ...replacement];
    else head = [...head.slice(0, -1), ...replacement];
  }

  const totalGroups = head.length + tail.length;
  if (halves.length === 1) {
    if (totalGroups !== 8) return null;
  } else {
    if (totalGroups > 7) return null; // `::` must elide at least one group
  }

  const fill = Array.from({ length: 8 - totalGroups }, () => "0");
  const groups = [...head, ...fill, ...tail];
  if (groups.length !== 8) return null;

  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(Number.parseInt(group, 16));
  }
  return value;
}

/** Parse an IP literal into a bigint + version, or null if invalid. */
function parseIp(ip: string): { value: bigint; version: 4 | 6 } | null {
  const family = isIP(ip);
  if (family === 4) {
    const value = ipv4ToBigInt(ip);
    return value === null ? null : { value, version: 4 };
  }
  if (family === 6) {
    const value = ipv6ToBigInt(ip);
    return value === null ? null : { value, version: 6 };
  }
  return null;
}

/** Parse a CIDR string (`10.0.0.0/8`, `fc00::/7`) into a `ParsedCidr`. */
export function parseCidr(cidr: string): ParsedCidr | null {
  const [addr, prefixStr] = cidr.split("/");
  if (addr === undefined || prefixStr === undefined) return null;
  const prefix = Number(prefixStr);
  if (!Number.isInteger(prefix) || prefix < 0) return null;
  const parsed = parseIp(addr);
  if (parsed === null) return null;
  const maxPrefix = parsed.version === 4 ? 32 : 128;
  if (prefix > maxPrefix) return null;
  return { network: parsed.value, prefix, version: parsed.version };
}

/** True when `ip` falls inside `cidr` (same version, masked-prefix match). */
export function ipInCidr(ip: string, cidr: ParsedCidr): boolean {
  const parsed = parseIp(ip);
  if (parsed === null || parsed.version !== cidr.version) return false;
  const totalBits = cidr.version === 4 ? 32 : 128;
  const hostBits = BigInt(totalBits - cidr.prefix);
  // A /0 means "everything"; avoid shifting by the full width.
  if (cidr.prefix === 0) return true;
  const mask = ((1n << BigInt(cidr.prefix)) - 1n) << hostBits;
  return (parsed.value & mask) === (cidr.network & mask);
}

/**
 * Find the first denied CIDR that contains `ip`, or null if none match.
 * Invalid CIDR strings in the denylist are skipped (fail-open per-entry, but
 * the default list is well-formed and operator-supplied entries that don't
 * parse simply do not block - they never accidentally allow something).
 */
export function findBlockingCidr(
  ip: string,
  denyCidrs: readonly string[],
): string | null {
  for (const raw of denyCidrs) {
    const parsed = parseCidr(raw);
    if (parsed === null) continue;
    if (ipInCidr(ip, parsed)) return raw;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Host resolution + validation
// ---------------------------------------------------------------------------

/** A resolved + validated target: the IP to actually connect to. */
export interface ResolvedTarget {
  /** The original hostname from the URL (for the Host header / SNI). */
  host: string;
  /** The validated IP literal to pin the connection to. */
  ip: string;
  /** 4 or 6. */
  family: 4 | 6;
}

type LookupFn = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

const systemLookup: LookupFn = (hostname) => lookup(hostname, { all: true });

/**
 * Resolve `host` to its IP(s), reject if ANY resolved IP is in `denyCidrs`,
 * and return the first allowed IP to pin the connection to.
 *
 * Rejecting when ANY resolved address is blocked (rather than picking an
 * allowed one) is deliberate: a name that resolves to BOTH a public IP and the
 * metadata IP is a classic rebind/confusion vector, so we refuse it outright.
 *
 * A bare IP literal in the URL is validated directly (no DNS).
 */
export async function resolveAndValidateHost({
  host,
  denyCidrs = DEFAULT_EGRESS_DENY_CIDRS,
  lookupFn = systemLookup,
}: {
  host: string;
  denyCidrs?: readonly string[];
  lookupFn?: LookupFn;
}): Promise<ResolvedTarget> {
  // Strip IPv6 brackets if the URL carried them (`[::1]`).
  const bareHost = host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1)
    : host;

  const literalFamily = isIP(bareHost);
  if (literalFamily !== 0) {
    const blocking = findBlockingCidr(bareHost, denyCidrs);
    if (blocking !== null) {
      throw new SsrfBlockedError(host, bareHost, blocking);
    }
    return {
      host,
      ip: bareHost,
      family: literalFamily === 4 ? 4 : 6,
    };
  }

  const records = await lookupFn(bareHost);
  if (records.length === 0) {
    throw new Error(`DNS lookup for ${host} returned no addresses.`);
  }

  // Reject if ANY resolved address is denied (rebind/confusion guard).
  for (const record of records) {
    const blocking = findBlockingCidr(record.address, denyCidrs);
    if (blocking !== null) {
      throw new SsrfBlockedError(host, record.address, blocking);
    }
  }

  const chosen = records[0];
  return {
    host,
    ip: chosen.address,
    family: chosen.family === 4 ? 4 : 6,
  };
}

/**
 * Rewrite a URL so its host component is the validated IP literal, preserving
 * scheme, port, path, query, and fragment. IPv6 literals are bracketed. The
 * caller restores the original `Host` header and (for https) TLS SNI so the
 * server still sees the intended virtual host.
 */
export function pinUrlToIp(originalUrl: string, ip: string): string {
  const parsed = new URL(originalUrl);
  parsed.hostname = isIP(ip) === 6 ? `[${ip}]` : ip;
  return parsed.toString();
}
