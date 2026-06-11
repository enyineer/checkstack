import type { MiddlewareHandler } from "hono";
import { normalizeHost, type PublicHostRegistry } from "./registry";
import { classifyPublicHostRequest, isBlocked } from "./routing";

/**
 * Hono middleware enforcing the public custom-domain lockdown. On a request
 * whose `Host` resolves to a configured public surface, it 404s everything
 * outside that surface's allow-list (see {@link classifyPublicHostRequest});
 * requests on the primary host or any unknown host pass through unchanged.
 *
 * Extracted as a factory (rather than inlined in the server) so the decision —
 * the actual isolation boundary — is unit-testable with a fake registry.
 */
export function createHostRoutingMiddleware({
  registry,
  primaryHost,
}: {
  registry: Pick<PublicHostRegistry, "resolve">;
  primaryHost: string | null;
}): MiddlewareHandler {
  return async (c, next) => {
    const host = normalizeHost(c.req.header("host"));
    if (!host || host === primaryHost) return next();
    const match = await registry.resolve(host);
    if (!match) return next(); // unknown host -> behave exactly as before
    const kind = classifyPublicHostRequest({
      path: c.req.path,
      allowedApiPaths: match.allowedApiPaths,
    });
    if (isBlocked(kind)) return c.notFound();
    return next();
  };
}
