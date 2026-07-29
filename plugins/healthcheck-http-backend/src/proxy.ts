/**
 * Proxy support for HTTP health checks.
 *
 * ## Why the SSRF guard changes shape behind a proxy
 *
 * Without a proxy, Checkstack resolves the target host itself and refuses any
 * address in a denied range (cloud metadata, link-local, plus operator extras).
 * That works because Checkstack is the thing making the connection.
 *
 * With a proxy configured, Checkstack connects to the PROXY; the proxy resolves
 * and reaches the target. Two consequences follow, and both are deliberate:
 *
 * 1. The denylist is applied to the **proxy host**, because that is the only
 *    host Checkstack actually connects to. A proxy pointed at a metadata
 *    endpoint is refused exactly as a target would be.
 * 2. The target host is **not pre-resolved locally**. A filtering proxy is very
 *    often the only thing that can resolve the target at all (split-horizon
 *    DNS, an internal-only zone), so a local resolution check would reject
 *    perfectly valid checks - and would in any case say nothing about what the
 *    proxy will connect to.
 *
 * So a configured proxy IS the egress policy boundary for that check. The
 * config field says so in its own description, because an operator choosing a
 * proxy is choosing where egress policy is enforced.
 */

/** Schemes a proxy URL may use. */
const ALLOWED_PROXY_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Validate a proxy URL, returning a human-readable problem or `undefined`.
 *
 * Returns a message rather than throwing so the config schema can attach it to
 * the `proxyUrl` field and the editor can show it inline.
 */
export function describeProxyUrlProblem({
  proxyUrl,
}: {
  proxyUrl: string;
}): string | undefined {
  // Check the scheme by PREFIX before parsing. `new URL("proxy.internal:3128")`
  // succeeds - it reads `proxy.internal:` as the scheme and `3128` as the path -
  // so a scheme-less host would otherwise be reported as "must use http or
  // https (got proxy.internal)", which tells the author nothing useful.
  const hasHttpScheme = /^https?:\/\//i.test(proxyUrl);
  if (!hasHttpScheme) {
    return "Proxy URL must be absolute and start with http:// or https://, e.g. http://proxy.internal:3128";
  }

  let parsed: URL;
  try {
    parsed = new URL(proxyUrl);
  } catch {
    return "Proxy URL must be an absolute URL, e.g. http://proxy.internal:3128";
  }

  if (!ALLOWED_PROXY_PROTOCOLS.has(parsed.protocol)) {
    return `Proxy URL must use http or https (got ${parsed.protocol.replace(":", "")})`;
  }

  if (!parsed.hostname) {
    return "Proxy URL must include a host";
  }

  return undefined;
}

/**
 * Build the proxy URL handed to `fetch`, folding in credentials when present.
 *
 * Credentials go in the URL's userinfo because that is the only channel Bun's
 * `fetch` proxy option exposes. They are percent-encoded, so a password
 * containing `@` or `:` cannot break out and silently rewrite the proxy host.
 *
 * Returns `undefined` when no proxy is configured, so the caller can spread the
 * result and get a direct connection.
 */
export function buildProxyUrl({
  proxyUrl,
  username,
  password,
}: {
  proxyUrl?: string;
  username?: string;
  password?: string;
}): string | undefined {
  const trimmed = proxyUrl?.trim();
  if (!trimmed) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    // Unreachable via the config path (the schema rejects it first), but a
    // malformed value must never become a request to a wrong host.
    return undefined;
  }

  if (username) {
    parsed.username = encodeURIComponent(username);
    if (password) parsed.password = encodeURIComponent(password);
  }

  return parsed.toString();
}

/**
 * The host whose address the SSRF denylist must be checked against.
 *
 * With a proxy, that is the proxy's host - the only host this process connects
 * to. Without one, it is the target's.
 */
export function resolveGuardedHost({
  targetUrl,
  proxyUrl,
}: {
  targetUrl: URL;
  proxyUrl?: string;
}): { host: string; viaProxy: boolean } {
  const trimmed = proxyUrl?.trim();
  if (!trimmed) return { host: targetUrl.hostname, viaProxy: false };

  try {
    return { host: new URL(trimmed).hostname, viaProxy: true };
  } catch {
    // A proxy is configured but unusable. Fall back to guarding the target so
    // we never end up with NO guard at all.
    return { host: targetUrl.hostname, viaProxy: false };
  }
}
