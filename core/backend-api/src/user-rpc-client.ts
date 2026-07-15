/**
 * USER-SCOPED cross-plugin RPC: build an `RpcClient` that re-enters the live
 * router AS the calling user - forwarding ONLY their session cookie and/or
 * bearer Authorization - never as a trusted service principal. Any
 * cross-plugin read made through it is subject to the CALLER'S own access
 * (RBAC + team grants), so "cannot expose what you cannot see" gates
 * (catalog readability on system links, satellite binding auth, AI deferred
 * tool routing, status-page publish) cannot silently widen a principal.
 *
 * Fail-closed by construction: if the request carries no forwardable auth
 * headers, the re-entered call runs ANONYMOUS and every authenticated
 * procedure rejects - a missing identity can never degrade to a service
 * principal.
 *
 * This is the ONE shared implementation (it used to exist as near-verbatim
 * copies in ai-backend, status-page-backend, telemetry-backend and the
 * stream plugins); a hardening change to header forwarding lands here once.
 */

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RpcClient } from "./types";

/**
 * Extract ONLY the forwardable auth headers (session cookie + bearer
 * Authorization) from a request's `Headers` view (e.g. the oRPC handler's
 * `context.requestHeaders`). Nothing else is ever forwarded - hop-by-hop and
 * infrastructure headers must not leak into the loopback call.
 */
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
 * Build the caller-scoped client over the internal URL (`${internalUrl}/api`).
 */
export function createUserScopedRpcClient({
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
      // Same accessor shape as the trusted client in core-services; typing is
      // provided by the RpcClient interface (InferClient<T>). The cast is the
      // untyped-transport boundary every RpcClient implementation crosses.
      return (client as Record<string, unknown>)[def.pluginId] as never;
    },
  };
}
