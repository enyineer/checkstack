import { resolveTxt as dnsResolveTxt } from "node:dns/promises";

/**
 * Resolves the TXT records for a name. Mirrors `node:dns`'s `resolveTxt`, which
 * returns one entry per record, each a list of string chunks (long TXT values
 * are split). Injectable so the verification logic is unit-testable without DNS.
 */
export type TxtResolver = (recordName: string) => Promise<string[][]>;

/** Default resolver backed by the system DNS (`node:dns/promises`). */
export const systemTxtResolver: TxtResolver = (recordName) =>
  dnsResolveTxt(recordName);

/** Non-public domain suffixes that must never be used as a public custom domain. */
const RESERVED_SUFFIXES = [
  ".local",
  ".localdomain",
  ".internal",
  ".lan",
  ".home.arpa",
  ".svc",
  ".cluster.local",
];

/**
 * Returns a human reason if `domain` must NOT be usable as a public custom
 * domain - the platform's own host (would shadow the admin origin in the
 * relation store / authorize hook), an IP literal, or an internal/non-routable
 * suffix - or null if it is acceptable. Both args are assumed lowercased;
 * single-label hosts (e.g. `localhost`) are already rejected by
 * `CustomDomainSchema`. Pure, so it is unit-testable.
 */
export function reservedDomainReason({
  domain,
  primaryHost,
}: {
  domain: string;
  primaryHost: string | null;
}): string | null {
  if (primaryHost && domain === primaryHost) {
    return "That is this Checkstack instance's own domain.";
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(domain)) {
    return "Enter a hostname, not an IP address.";
  }
  if (RESERVED_SUFFIXES.some((suffix) => domain.endsWith(suffix))) {
    return "Internal or non-public domains cannot be used.";
  }
  return null;
}

/**
 * True when the TXT records at `recordName` contain an entry equal to `token`
 * (chunks of a single record are joined first, per DNS semantics). A DNS
 * failure (NXDOMAIN, no TXT, network error) resolves to `false` — never throws —
 * so "not yet propagated" is simply "not verified".
 */
export async function verifyDomainTxt({
  recordName,
  token,
  resolveTxt,
}: {
  recordName: string;
  token: string;
  resolveTxt: TxtResolver;
}): Promise<boolean> {
  try {
    const records = await resolveTxt(recordName);
    return records.some((chunks) => chunks.join("").trim() === token);
  } catch {
    return false;
  }
}
