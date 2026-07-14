/**
 * SSRF-guarded `fetch` for outbound requests to attacker-influenced URLs (a
 * config-derived vendor API, a metrics endpoint, a user-supplied target).
 *
 * Every request is pre-flight validated with the SSRF guard: the host is
 * resolved and rejected if ANY resolved IP is in the denied egress ranges
 * (cloud-metadata / link-local by default), and only `http`/`https` schemes are
 * allowed (blocking `file:`/`data:` and other scheme escapes).
 *
 * Redirects are followed MANUALLY, re-validating each hop's host, so a 3xx to an
 * internal address cannot bypass the pre-flight check (bounded by
 * `maxRedirects`). Set `maxRedirects: 0` to NOT follow redirects at all - the
 * 3xx response is returned as-is so the caller can inspect it.
 *
 * DESIGN NOTE: this validates the host and then fetches the ORIGINAL URL rather
 * than pinning the connection to the resolved IP. Pinning (rewriting the URL
 * host to the IP literal) breaks TLS SNI / certificate validation for https
 * vendor endpoints, and breaks HTTP/2 origin authority. The trade-off is a
 * narrow DNS-rebind TOCTOU window (a host could resolve to an allowed IP at
 * validation and a denied one at connect); the static-resolution and IP-literal
 * cases - the ones that matter in practice - are still blocked.
 */

import {
  resolveAndValidateHost,
  DEFAULT_EGRESS_DENY_CIDRS,
} from "./ssrf-guard";
import type { Logger } from "./types";

/** Schemes a guarded fetch may request. */
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

/** DNS resolver seam mirroring `resolveAndValidateHost`'s lookup contract. */
export type GuardedLookupFn = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

/** Error thrown for a request the guard refuses to issue. */
export class GuardedFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardedFetchError";
  }
}

/**
 * Build an SSRF-guarded `fetch`. The returned function matches the global
 * `fetch` signature so it can be handed anywhere a `fetch` is expected.
 */
export function createGuardedFetch({
  logger,
  denyCidrs = DEFAULT_EGRESS_DENY_CIDRS,
  lookupFn,
  maxRedirects = 5,
  fetchImpl = fetch,
}: {
  logger: Logger;
  denyCidrs?: readonly string[];
  lookupFn?: GuardedLookupFn;
  /**
   * Maximum redirects to follow, re-validating each hop. `0` means "do not
   * follow" - the first 3xx response is returned as-is.
   */
  maxRedirects?: number;
  fetchImpl?: typeof fetch;
}): typeof fetch {
  const guarded = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    let currentUrl = resolveInputUrl(input);
    // The init evolves across hops: a 303 (and a 301/302) rewrites the next
    // request to GET with no body; a 307/308 replays method + body verbatim.
    let currentInit: RequestInit = { ...init };

    for (let hop = 0; hop <= maxRedirects; hop++) {
      let parsed: URL;
      try {
        parsed = new URL(currentUrl);
      } catch {
        throw new GuardedFetchError(`invalid URL: ${currentUrl}`);
      }
      if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
        throw new GuardedFetchError(
          `scheme not allowed: ${parsed.protocol}`,
        );
      }
      try {
        await resolveAndValidateHost({
          host: parsed.hostname,
          denyCidrs,
          ...(lookupFn === undefined ? {} : { lookupFn }),
        });
      } catch (error) {
        throw new GuardedFetchError(
          `refusing to fetch ${parsed.hostname}: ${String(error)}`,
        );
      }

      const response = await fetchImpl(currentUrl, {
        ...currentInit,
        redirect: "manual",
      });

      if (!isRedirect(response.status)) return response;

      const location = response.headers.get("location");
      if (!location) return response;

      // A redirect we could follow. If the follow budget is exhausted, either
      // hand the 3xx back unfollowed (no-follow mode: `maxRedirects === 0`) or
      // fail as a redirect loop / too-deep chain (`maxRedirects > 0`).
      if (hop >= maxRedirects) {
        if (maxRedirects === 0) return response;
        throw new GuardedFetchError(`too many redirects (> ${maxRedirects})`);
      }

      await response.body?.cancel();
      const nextUrlParsed = new URL(location, currentUrl);
      // Compute the next hop's request per the redirect status BEFORE reassigning
      // currentUrl, so a non-replayable-body 307/308 fails with a clear error.
      currentInit = nextRequestInit({ init: currentInit, status: response.status });
      // Strip credential headers when the redirect crosses to a DIFFERENT origin
      // (scheme + host + port). browsers and undici drop credentials on a
      // cross-origin redirect; a manual follower that forwards them verbatim
      // would replay a configured bearer / cookie to whatever host the target
      // redirects to (a redirecting scrape endpoint could exfiltrate it).
      if (parsed.origin !== nextUrlParsed.origin) {
        currentInit = stripCredentialHeaders(currentInit);
      }
      const nextUrl = nextUrlParsed.toString();
      logger.debug(`guarded fetch following redirect to ${nextUrl}`);
      currentUrl = nextUrl;
    }

    throw new GuardedFetchError(`too many redirects (> ${maxRedirects})`);
  };

  // The global `fetch` type is a callable with extra members (`.preconnect`) in
  // recent lib.dom typings; a caller only ever invokes it, so exposing the call
  // signature is sufficient.
  return guarded as unknown as typeof fetch;
}

function isRedirect(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

/**
 * Derive the next hop's `RequestInit` from the redirect status (fetch spec
 * behavior):
 *
 * - 301 / 302 / 303 -> the subsequent request becomes a GET with NO body (and
 *   the body-describing content headers dropped). Naively re-sending the
 *   original `{ ...init }` would replay the POST method and body to the redirect
 *   target, which is wrong.
 * - 307 / 308 -> method and body are preserved verbatim. A body that can only be
 *   read once (a `ReadableStream`) cannot be replayed on the next hop, so we fail
 *   with a clear {@link GuardedFetchError} instead of letting the underlying
 *   fetch throw a cryptic "body already used".
 */
function nextRequestInit({
  init,
  status,
}: {
  init: RequestInit;
  status: number;
}): RequestInit {
  if (status === 301 || status === 302 || status === 303) {
    return toBodylessGet(init);
  }
  assertReplayableBody(init.body);
  return init;
}

/** Rewrite an init to a GET with no body and no body-describing headers. */
function toBodylessGet(init: RequestInit): RequestInit {
  const headers = new Headers(init.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  headers.delete("content-encoding");
  const { body: _body, ...rest } = init;
  return { ...rest, method: "GET", headers };
}

/** Throw a clear error when a 307/308 would need to replay a one-shot body. */
function assertReplayableBody(body: RequestInit["body"]): void {
  if (
    typeof ReadableStream !== "undefined" &&
    body instanceof ReadableStream
  ) {
    throw new GuardedFetchError(
      "cannot follow a 307/308 redirect: the request body is a stream and " +
        "cannot be replayed to the redirect target",
    );
  }
}

/**
 * Credential-bearing headers dropped when a redirect crosses origins. Matched
 * case-insensitively (a `Headers` normalizes names), so the forwarded init
 * never replays them to a different host.
 */
const CREDENTIAL_HEADERS = ["authorization", "proxy-authorization", "cookie"];

/**
 * Return an init with the credential headers removed. `init.headers` may be a
 * `Headers`, an entries array, or a record; normalizing through `new Headers`
 * once handles all three shapes and the case-insensitive delete.
 */
function stripCredentialHeaders(init: RequestInit): RequestInit {
  const headers = new Headers(init.headers);
  for (const name of CREDENTIAL_HEADERS) headers.delete(name);
  return { ...init, headers };
}

function resolveInputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}
