import type {
  PublicHostMatch,
  PublicHostResolver,
  PublicHostResolverExtensionPoint,
} from "@checkstack/backend-api";

/**
 * Normalize a raw `Host` header to a comparable hostname: lowercased, trimmed,
 * port stripped. Returns null for empty input or an IPv6 literal (`[::1]`),
 * which is never a configured custom domain.
 */
export function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.startsWith("[")) return null;
  const host = trimmed.split(":")[0] ?? "";
  return host.length > 0 ? host : null;
}

/**
 * The effective CLIENT host for public-surface routing, honoring the edge's
 * forwarding headers. An edge proxy that terminates TLS commonly rewrites the
 * upstream `Host` header to the internal service address and puts the ORIGINAL
 * browser host in `X-Forwarded-Host`. This resolver prefers `X-Forwarded-Host`
 * (first hop) and falls back to `Host`, so a custom domain still resolves to its
 * status page behind such a proxy.
 *
 * This MUST match how the backend derives `requestOrigin` (which already honors
 * `X-Forwarded-Host`): if routing used the raw `Host` while origin used the
 * forwarded host, a request behind a Host-rewriting proxy would resolve to the
 * INTERNAL host for routing (no public match -> the admin bundle is served) even
 * though the browser is on the custom domain. That mismatch made custom domains
 * load the admin app in production while every test - which sends `Host`
 * directly, with no proxy in front - passed.
 *
 * `header` is the request's header getter (e.g. Hono's `c.req.header`), taken as
 * a function so the resolver is pure and unit-testable without a live request.
 */
export function resolveRequestHost(
  header: (name: string) => string | null | undefined,
): string | null {
  const forwarded = header("x-forwarded-host");
  const firstHop = forwarded?.split(",")[0]?.trim();
  return normalizeHost(firstHop || header("host"));
}

interface CacheEntry {
  value: PublicHostMatch | null;
  expiresAt: number;
}

export interface PublicHostRegistryOptions {
  /** TTL for cached resolutions (BOTH hits and misses). Default 60s. */
  ttlMs?: number;
  /** Injectable clock (ms) for tests. */
  now?: () => number;
  /**
   * Max cached hosts. A flood of unique `Host` headers (the host is attacker-
   * controlled on the public surface) would otherwise grow the cache without
   * bound. On overflow the oldest entry is evicted (insertion-ordered Map).
   */
  maxEntries?: number;
}

export interface PublicHostRegistry {
  /** The extension-point impl plugins call to contribute resolvers. */
  extensionPoint: PublicHostResolverExtensionPoint;
  /**
   * Resolve a normalized host to a match, or null. Caches hits AND misses for
   * `ttlMs`, and single-flights concurrent lookups for the same host, so a flood
   * of requests on one (or an unknown) host triggers at most one resolver pass.
   */
  resolve(host: string): Promise<PublicHostMatch | null>;
  /**
   * Drop a host (or, with no arg, everything) from the cache. Reserved for a
   * future cluster-wide invalidation (an event-bus "public-host changed" signal
   * each pod subscribes to); today removal/unpublish rely on the short TTL.
   */
  invalidate(host?: string): void;
}

/**
 * The platform-owned registry of {@link PublicHostResolver}s. core/backend
 * registers this as the {@link publicHostResolverExtensionPoint} implementation
 * and consults `resolve()` from the host-routing middleware. It never imports
 * any contributing plugin — plugins push resolvers in via `registerResolver`.
 */
export function createPublicHostRegistry(
  options: PublicHostRegistryOptions = {},
): PublicHostRegistry {
  const ttlMs = options.ttlMs ?? 60_000;
  const now = options.now ?? (() => Date.now());
  const maxEntries = options.maxEntries ?? 10_000;
  const resolvers: PublicHostResolver[] = [];
  const cache = new Map<string, CacheEntry>();
  const inflight = new Map<string, Promise<PublicHostMatch | null>>();

  async function resolveUncached(
    host: string,
  ): Promise<PublicHostMatch | null> {
    for (const resolver of resolvers) {
      try {
        const match = await resolver.resolve(host);
        if (match) return match;
      } catch {
        // A failing resolver must not break host routing for other surfaces;
        // skip it and try the next one. (Treated as "no match" for this host.)
      }
    }
    return null;
  }

  return {
    extensionPoint: {
      registerResolver: (resolver) => {
        resolvers.push(resolver);
      },
    },
    async resolve(host) {
      const cached = cache.get(host);
      if (cached && cached.expiresAt > now()) return cached.value;
      const existing = inflight.get(host);
      if (existing) return existing;
      const pending = resolveUncached(host)
        .then((value) => {
          // Bound memory: evict the oldest entry before inserting a new host.
          if (!cache.has(host) && cache.size >= maxEntries) {
            const oldest = cache.keys().next().value;
            if (oldest !== undefined) cache.delete(oldest);
          }
          cache.set(host, { value, expiresAt: now() + ttlMs });
          return value;
        })
        .finally(() => {
          inflight.delete(host);
        });
      inflight.set(host, pending);
      return pending;
    },
    invalidate(host) {
      if (host === undefined) cache.clear();
      else cache.delete(host);
    },
  };
}
