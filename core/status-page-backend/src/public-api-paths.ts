import { statusPageContract } from "@checkstack/status-page-common";

/**
 * Every procedure the PUBLIC status-page surface may call on a custom-domain
 * host.
 *
 * A verified custom domain serves only the public page: the host-routing
 * middleware 404s any `/api` path not in this list. So omitting a procedure the
 * public bundle calls breaks that procedure ON CUSTOM DOMAINS ONLY, silently -
 * the in-app `/statuspage/view/<slug>` route keeps working, so the failure is
 * invisible until someone loads the real domain. That is exactly what would
 * have happened to `resolvePublicMentions`: mentions would resolve in the app
 * and render as plain text on every customer domain.
 *
 * Keep this list to procedures the public surface genuinely needs. Adding one
 * widens what an anonymous visitor on that host can reach.
 */
export const PUBLIC_HOST_PROCEDURES = [
  "getPublishedStatusPage",
  "getPublishedIncident",
  "getPublishedMaintenance",
  "resolvePublicMentions",
] as const satisfies ReadonlyArray<keyof typeof statusPageContract>;

/**
 * The allow-listed `/api` paths for a public host, in the platform's
 * `/api/<pluginId>/<procedure>` shape.
 */
export function buildPublicHostApiPaths({
  pluginId,
}: {
  pluginId: string;
}): string[] {
  return PUBLIC_HOST_PROCEDURES.map((name) => `/api/${pluginId}/${name}`);
}
