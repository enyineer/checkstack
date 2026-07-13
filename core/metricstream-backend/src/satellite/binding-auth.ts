/**
 * Authorization for BINDING a scrape target to a satellite.
 *
 * SECURITY (SAT-C, HIGH): the `satelliteId` on a scrape target is caller-supplied
 * via the create/update RPC. The stream-scoped `manage` gate (idParam: "streamId")
 * only proves the caller may manage THEIR stream - it does NOT prove they may use
 * a given satellite. Without this check a team-scoped stream manager could bind
 * their target to ANOTHER team's satellite + an internal URL in that satellite's
 * network zone, turning core into a cross-zone SSRF pivot (the satellite scrapes
 * the internal URL and forwards the data into the caller's stream). The runtime
 * binding check in the capability handler does NOT cover this - it only stops a
 * satellite claiming targets it is not bound to, not WHO may author the binding.
 *
 * The gate, applied whenever a NON-NULL satelliteId is set on create OR update
 * (including a rebind), requires:
 *   1. the satellite EXISTS (else BAD_REQUEST);
 *   2. the CALLER can READ it - enforced by re-entering the satellite RPC AS the
 *      caller (a user-scoped client forwarding their auth), so `getSatellite`'s
 *      own `satellite.read` gate rejects with FORBIDDEN when they cannot see it;
 *   3. the satellite advertises the `scrape` capability (else BAD_REQUEST).
 * A null satelliteId (scrape from core) needs no check.
 */

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { ORPCError } from "@orpc/server";
import type { RpcClient } from "@checkstack/backend-api";
import { SatelliteApi } from "@checkstack/satellite-common";

/** The capability string a satellite advertises when it can scrape (agent-side). */
export const SATELLITE_SCRAPE_CAPABILITY = "scrape";

/**
 * Verify the caller may bind a scrape target to `satelliteId`, using a client
 * scoped to the CALLER (so the satellite's own `satellite.read` gate applies).
 * Throws FORBIDDEN (propagated from `getSatellite`) when the caller cannot read
 * the satellite, and BAD_REQUEST when it does not exist or cannot scrape.
 */
export async function assertSatelliteScrapeBindable({
  client,
  satelliteId,
}: {
  client: RpcClient;
  satelliteId: string;
}): Promise<void> {
  // `getSatellite` is `satellite.read`-gated: as the caller, a missing read
  // grant surfaces here as FORBIDDEN (binding to a satellite you cannot even see
  // is the exploit). We deliberately do NOT catch that - it must propagate.
  const satellite = await client
    .forPlugin(SatelliteApi)
    .getSatellite({ id: satelliteId });

  if (!satellite) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Satellite not found.",
    });
  }
  if (!satellite.capabilities.includes(SATELLITE_SCRAPE_CAPABILITY)) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Satellite does not support scraping.",
    });
  }
}

/**
 * A per-request gate the router invokes before persisting a non-null satelliteId.
 * Bound to the internal URL once; called with the caller's request headers so the
 * re-entrant `getSatellite` runs as the caller.
 */
export type SatelliteBindingAuthorizer = (args: {
  satelliteId: string;
  requestHeaders: Headers | undefined;
}) => Promise<void>;

/** Extract ONLY the forwardable auth headers (cookie + bearer) from a request. */
export function forwardableAuthHeadersFrom(
  headers: Headers | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  const cookie = headers.get("cookie");
  if (cookie) out.cookie = cookie;
  const authorization = headers.get("authorization");
  if (authorization) out.authorization = authorization;
  return out;
}

/**
 * Build a USER-SCOPED RpcClient that re-enters the live router AS the calling
 * user (forwarding their cookie / bearer), never as a trusted service - so a
 * cross-plugin read is subject to the caller's own access. Mirrors the
 * status-page publish gate + the AI chat read-invoker.
 */
function createUserScopedRpcClient({
  internalUrl,
  forwardHeaders,
}: {
  internalUrl: string;
  forwardHeaders: Record<string, string>;
}): RpcClient {
  const link = new RPCLink({ url: `${internalUrl}/api`, headers: forwardHeaders });
  const client = createORPCClient(link);
  return {
    forPlugin(def) {
      return (client as Record<string, unknown>)[def.pluginId] as never;
    },
  };
}

/**
 * Production {@link SatelliteBindingAuthorizer}: for each request, builds a
 * caller-scoped client and runs {@link assertSatelliteScrapeBindable}. Injected
 * into the router so tests can substitute a deterministic authorizer without an
 * HTTP round-trip.
 */
export function createSatelliteBindingAuthorizer({
  internalUrl,
}: {
  internalUrl: string;
}): SatelliteBindingAuthorizer {
  return async ({ satelliteId, requestHeaders }) => {
    const client = createUserScopedRpcClient({
      internalUrl,
      forwardHeaders: forwardableAuthHeadersFrom(requestHeaders),
    });
    await assertSatelliteScrapeBindable({ client, satelliteId });
  };
}
