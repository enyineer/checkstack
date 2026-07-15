/**
 * Authorization POLICY for BINDING a telemetry pull source instance to a
 * satellite. Pure (no transport dependency) so it unit-tests with a fake client;
 * the caller-scoped client that satisfies {@link SatelliteBindingAuthorizer} in
 * production lives in `./binding-auth-client` (it imports `@orpc/client`).
 *
 * SECURITY (SSRF pivot, HIGH): the `satelliteId` on a source instance is
 * caller-supplied via the create/update RPC. The source `manage` gate
 * (idParam / create) only proves the caller may manage THEIR instance - it does
 * NOT prove they may use a given satellite. Without this check a team-scoped
 * source manager could bind their instance to ANOTHER team's satellite + an
 * internal URL in that satellite's network zone, turning core into a cross-zone
 * SSRF pivot (the satellite pulls the internal URL and forwards the telemetry
 * into the caller's stream). The runtime binding check in the capability handler
 * does NOT cover this - it only stops a satellite claiming instances it is not
 * bound to, not WHO may author the binding.
 *
 * The gate, applied whenever a NON-NULL satelliteId is set on create OR update
 * (including a rebind), requires:
 *   1. the satellite EXISTS (else BAD_REQUEST);
 *   2. the CALLER can READ it - enforced by re-entering the satellite RPC AS the
 *      caller (a user-scoped client forwarding their auth), so `getSatellite`'s
 *      own `satellite.read` gate rejects with FORBIDDEN when they cannot see it;
 *   3. the satellite advertises the `telemetry-pull` capability (else BAD_REQUEST).
 * A null satelliteId (pull from core) needs no check.
 *
 * Mirrors metricstream's `assertSatelliteScrapeBindable` exactly (SAT-C).
 */

import { ORPCError } from "@orpc/server";
import type { RpcClient } from "@checkstack/backend-api";
import { SatelliteApi } from "@checkstack/satellite-common";
import { TELEMETRY_PULL_CAPABILITY_KIND } from "@checkstack/telemetry-common";

/** The capability a satellite advertises when it can run telemetry pulls. */
export const SATELLITE_TELEMETRY_PULL_CAPABILITY = TELEMETRY_PULL_CAPABILITY_KIND;

/**
 * Verify the caller may bind a pull source to `satelliteId`, using a client
 * scoped to the CALLER (so the satellite's own `satellite.read` gate applies).
 * Throws FORBIDDEN (propagated from `getSatellite`) when the caller cannot read
 * the satellite, and BAD_REQUEST when it does not exist or cannot pull.
 */
export async function assertSatellitePullBindable({
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
  if (!satellite.capabilities.includes(SATELLITE_TELEMETRY_PULL_CAPABILITY)) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Satellite does not support telemetry pull execution.",
    });
  }
}

/**
 * A per-request gate the service invokes before persisting a non-null
 * satelliteId. Bound to the internal URL once; called with the caller's request
 * headers so the re-entrant `getSatellite` runs as the caller.
 */
export type SatelliteBindingAuthorizer = (args: {
  satelliteId: string;
  requestHeaders: Headers | undefined;
}) => Promise<void>;
