import type { PluginMetadata } from "@checkstack/common";
import { createExtensionPoint } from "./extension-point";

/**
 * A match for an incoming `Host` header that belongs to a public, custom-domain
 * surface owned by some plugin (e.g. a published status page served on
 * `status.acme.com`). Returned by a {@link PublicHostResolver}. The platform
 * uses it to lock the request down to ONLY the public surface — see the host
 * routing in `core/backend`.
 *
 * The platform stays ignorant of what the surface is: it never interprets
 * `bootstrap`, and it enforces `allowedApiPaths` as an opaque string allow-list.
 * This keeps the dependency direction correct (the platform DEFINES the
 * contract; the owning domain plugin SUPPLIES the resolver).
 */
export interface PublicHostMatch {
  /** The plugin that owns this host. Used for logging/metrics only. */
  pluginId: string;
  /**
   * Opaque bootstrap hint surfaced verbatim to the public bundle via
   * `/api/config` (e.g. `{ kind: "status-page", slug }`) so the bundle knows
   * what to render WITHOUT a URL path. The platform does not read it.
   */
  bootstrap: Record<string, unknown>;
  /**
   * The exact `/api/...` paths the public bundle may call on this host.
   * EVERYTHING else under `/api` — and ALL of `/rest` — is blocked with a 404.
   * This allow-list IS the isolation boundary on a custom-domain host, so it
   * must be exhaustive and as small as possible (ideally the single public read
   * endpoint the surface needs). `/api/config` is always permitted by the
   * platform and need not be listed here.
   */
  allowedApiPaths: readonly string[];
}

/**
 * Resolves an incoming Host to a public surface. Contributed by the owning
 * domain plugin via {@link publicHostResolverExtensionPoint}.
 */
export interface PublicHostResolver {
  /**
   * Resolve a normalized (lowercased, port-stripped) Host header to a public
   * surface, or `null` if this resolver does not own the host.
   *
   * MUST be cheap and cached: it runs on every request whose Host is not the
   * primary app host. Implementations should cache both hits AND misses with a
   * short TTL so stray/unknown Host headers cannot hammer the database.
   */
  resolve(host: string): Promise<PublicHostMatch | null>;
}

/**
 * The platform-owned extension point through which a domain plugin contributes
 * a {@link PublicHostResolver}. The platform (core/backend) owns the registry
 * and consults the registered resolvers on each non-primary-host request; it
 * never imports the contributing plugin.
 */
export interface PublicHostResolverExtensionPoint {
  registerResolver(
    resolver: PublicHostResolver,
    pluginMetadata: PluginMetadata,
  ): void;
}

export const publicHostResolverExtensionPoint =
  createExtensionPoint<PublicHostResolverExtensionPoint>(
    "core.publicHostResolver",
  );
