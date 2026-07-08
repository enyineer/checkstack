import { normalizeHost, type PublicHostRegistry } from "./registry";

/**
 * Build the dynamic CORS `origin` decision used by the platform's global `cors`
 * middleware. It returns the request's own `Origin` when that origin is allowed
 * (so hono echoes it back as `Access-Control-Allow-Origin`), or `null` to DENY
 * (no ACAO header emitted).
 *
 * The allow-set is bounded and never a wildcard:
 *
 * - the static `staticOrigins` (the admin `BASE_URL`, plus the Vite dev origin
 *   in development), and
 * - any Origin whose host resolves to a configured custom-domain public surface
 *   via the {@link PublicHostRegistry} (a status page on its own domain).
 *
 * Everything else — an arbitrary third-party `Origin`, a malformed one, or the
 * primary host reached as a cross-origin — is DENIED. The host is
 * attacker-controlled, so resolution stays bounded by the registry's cached,
 * size-capped lookup (never an unbounded per-Origin DB hit).
 *
 * Extracted as a pure factory (like {@link createHostRoutingMiddleware}) so the
 * origin decision — the actual cross-origin boundary — is unit-testable with a
 * fake registry, and so an e2e test can drive the REAL decision through hono's
 * `cors` middleware without it drifting from production.
 */
export function createCorsOriginResolver({
  staticOrigins,
  primaryHost,
  registry,
}: {
  /** Always-allowed origins (admin `BASE_URL`, and the Vite dev origin in dev). */
  staticOrigins: readonly string[];
  /** The app's own host; a cross-origin request FROM it is not special-cased. */
  primaryHost: string | null;
  /** Resolves a normalized host to a configured public surface, or null. */
  registry: Pick<PublicHostRegistry, "resolve">;
}): (origin: string) => Promise<string | null> {
  const allowed = new Set(staticOrigins);
  return async (origin: string): Promise<string | null> => {
    if (!origin) return null;
    if (allowed.has(origin)) return origin;
    try {
      const host = normalizeHost(new URL(origin).host);
      if (host && host !== primaryHost) {
        const match = await registry.resolve(host);
        if (match) return origin;
      }
    } catch {
      // Malformed Origin header -> deny (fall through).
    }
    return null;
  };
}
