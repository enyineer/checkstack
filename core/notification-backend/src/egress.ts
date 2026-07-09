import {
  DEFAULT_EGRESS_DENY_CIDRS,
  resolveAndValidateHost,
  SsrfBlockedError,
} from "@checkstack/backend-api";

/**
 * SSRF denylist for USER-SUPPLIED outbound URLs (webhook channel, Discord/Slack
 * incoming webhooks, a Gotify server URL, a Backstage base URL, ...).
 *
 * Policy: block the classic exfiltration / pivot targets ONLY -
 * cloud-metadata, link-local, IPv6 ULA (all via `DEFAULT_EGRESS_DENY_CIDRS`),
 * the loopback interface (`127.0.0.0/8`, `::1/128`), and the "this host"
 * `0.0.0.0/8` alias (a loopback bypass). Internal RFC1918 / CGNAT ranges are
 * deliberately ALLOWED, because a self-hosted internal Gotify / Backstage /
 * webhook receiver on `10.x` / `192.168.x` is a legitimate, common target.
 */
export const WEBHOOK_EGRESS_DENY_CIDRS: readonly string[] = [
  ...DEFAULT_EGRESS_DENY_CIDRS, // cloud-metadata + link-local + IPv6 ULA
  "0.0.0.0/8", // "this host" (loopback bypass)
  "127.0.0.0/8", // IPv4 loopback
  "::1/128", // IPv6 loopback
];

/** Outcome of {@link validateWebhookUrl}. */
export type WebhookUrlValidation =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Validate a user-supplied outbound URL before dispatch: it must be a
 * well-formed http(s) URL, and its host must not resolve to any denied egress
 * range. Reuses the platform SSRF guard (`resolveAndValidateHost`), which
 * resolves the host to IP(s) and rejects the request when ANY resolved address
 * is denied - so a public-looking name that resolves to a private IP is caught
 * too.
 *
 * This is a PRE-FLIGHT check only. Because `fetch` re-resolves DNS and may
 * follow redirects, every caller MUST ALSO pass `redirect: "error"` to
 * `postJson` (or otherwise refuse redirects), so a 3xx to an unvalidated
 * internal host cannot slip past this guard. A narrow DNS-rebind TOCTOU window
 * remains, but statically-denied names, direct denied literals, and all
 * redirect-based pivots are blocked - the common cases.
 */
export async function validateWebhookUrl({
  url,
  lookupFn,
}: {
  url: string;
  lookupFn?: (
    hostname: string,
  ) => Promise<Array<{ address: string; family: number }>>;
}): Promise<WebhookUrlValidation> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: `Invalid URL: "${url}".` };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      error: `URL must be http or https (got "${parsed.protocol}").`,
    };
  }

  try {
    await resolveAndValidateHost({
      host: parsed.hostname,
      denyCidrs: WEBHOOK_EGRESS_DENY_CIDRS,
      ...(lookupFn ? { lookupFn } : {}),
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof SsrfBlockedError) {
      return {
        ok: false,
        error:
          "Refusing to deliver to a private/internal/reserved address. " +
          "The URL must point at a publicly reachable host.",
      };
    }
    return {
      ok: false,
      error: `Could not resolve host "${parsed.hostname}".`,
    };
  }
}
