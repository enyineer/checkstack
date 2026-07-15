/**
 * Production {@link SatelliteBindingAuthorizer}: builds a CALLER-scoped RpcClient
 * (forwarding the caller's cookie / bearer) that re-enters the live router over
 * the internal URL, so the satellite's own `satellite.read` gate applies. Kept
 * separate from the pure `./binding-auth` policy so the policy unit-tests without
 * a transport dependency. Mirrors the status-page publish gate + the AI chat
 * read-invoker.
 */

import {
  createUserScopedRpcClient,
  forwardableAuthHeadersFrom,
} from "@checkstack/backend-api";
import {
  assertSatellitePullBindable,
  type SatelliteBindingAuthorizer,
} from "./binding-auth";

/**
 * Production authorizer: for each request, builds a caller-scoped client and runs
 * {@link assertSatellitePullBindable}. Injected into the service so tests can
 * substitute a deterministic authorizer without an HTTP round-trip.
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
    await assertSatellitePullBindable({ client, satelliteId });
  };
}
