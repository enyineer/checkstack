/**
 * How a request on a matched custom-domain (public) host should be treated.
 *
 * On such a host the platform exposes ONLY the public surface: the bundle's own
 * static assets, the host-aware `/api/config`, and the resolver's
 * `allowedApiPaths`. Everything else under `/api`, all of `/rest`, and the admin
 * docs are blocked. Navigational routes serve the separate PUBLIC bundle, never
 * the admin SPA shell.
 */
export type PublicHostRequestKind =
  | "api-allowed"
  | "api-blocked"
  | "rest-blocked"
  | "docs-blocked"
  | "platform-blocked"
  | "navigational";

/** `/api/config` is always allowed on a public host (the bundle boots from it). */
const ALWAYS_ALLOWED_API_PATHS = new Set(["/api/config"]);

/**
 * The on-demand-TLS authorization hook. Must stay reachable on ANY host because
 * the edge proxy may call it with the custom domain as its Host while asking
 * whether to mint that domain's certificate. It reveals only yes/no for one
 * host, so allowing it does not widen the data surface.
 */
const ALWAYS_ALLOWED_PATHS = new Set([
  "/.well-known/checkstack/authorize-domain",
]);

/**
 * Classify a request path on a matched public host. Pure: no IO, no host
 * resolution — the caller has already matched the host and supplies the
 * resolver's `allowedApiPaths`.
 *
 * The whole point is a DENY-by-default surface: the only things that reach a
 * backend handler on a public host are `/api/config`, the resolver's single
 * public read endpoint, the TLS hook, and static assets / the public SPA. Every
 * other `/api`, all `/rest`, the admin docs, and the platform endpoints
 * (`/.checkstack/*` readiness, `/.well-known/jwks.json`, ...) are refused, so a
 * published page cannot reach any other data or operational endpoint.
 */
export function classifyPublicHostRequest({
  path,
  allowedApiPaths,
}: {
  path: string;
  allowedApiPaths: readonly string[];
}): PublicHostRequestKind {
  if (ALWAYS_ALLOWED_PATHS.has(path)) return "navigational";
  if (path.startsWith("/api/")) {
    if (ALWAYS_ALLOWED_API_PATHS.has(path) || allowedApiPaths.includes(path)) {
      return "api-allowed";
    }
    return "api-blocked";
  }
  if (path.startsWith("/rest/")) return "rest-blocked";
  // The in-app user guide (admin docs) must not be reachable from a public host.
  if (path === "/checkstack" || path.startsWith("/checkstack/")) {
    return "docs-blocked";
  }
  // Platform + other well-known endpoints (readiness with plugin-check names,
  // health, JWKS, ...) are not part of a published page and must not respond on
  // a public host. Liveness/readiness probes hit the pod's internal address, not
  // the custom domain, so blocking them here does not affect orchestration.
  if (path.startsWith("/.checkstack/") || path.startsWith("/.well-known/")) {
    return "platform-blocked";
  }
  // Static assets (served by earlier handlers) and SPA navigation. The SPA
  // fallback serves the PUBLIC bundle for these; assets are public files.
  return "navigational";
}

/** True when the classification means the request must be refused with a 404. */
export function isBlocked(kind: PublicHostRequestKind): boolean {
  return (
    kind === "api-blocked" ||
    kind === "rest-blocked" ||
    kind === "docs-blocked" ||
    kind === "platform-blocked"
  );
}
