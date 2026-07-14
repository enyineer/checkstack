/**
 * Production {@link SatelliteBindingAuthorizer}: builds a CALLER-scoped RpcClient
 * (forwarding the caller's cookie / bearer) that re-enters the live router over
 * the internal URL, so the satellite's own `satellite.read` gate applies. Kept
 * separate from the pure `./binding-auth` policy so the policy unit-tests without
 * a transport dependency. Mirrors the status-page publish gate + the AI chat
 * read-invoker.
 */

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RpcClient } from "@checkstack/backend-api";
import {
  assertSatellitePullBindable,
  forwardableAuthHeadersFrom,
  type SatelliteBindingAuthorizer,
} from "./binding-auth";

/**
 * Build a USER-SCOPED RpcClient that re-enters the live router AS the calling
 * user (forwarding their cookie / bearer), never as a trusted service - so a
 * cross-plugin read is subject to the caller's own access.
 */
function createUserScopedRpcClient({
  internalUrl,
  forwardHeaders,
}: {
  internalUrl: string;
  forwardHeaders: Record<string, string>;
}): RpcClient {
  const link = new RPCLink({
    url: `${internalUrl}/api`,
    headers: forwardHeaders,
  });
  const client = createORPCClient(link);
  return {
    forPlugin(def) {
      return (client as Record<string, unknown>)[def.pluginId] as never;
    },
  };
}

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
