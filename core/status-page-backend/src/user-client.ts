import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RpcClient } from "@checkstack/backend-api";

/**
 * Build a USER-SCOPED RpcClient that re-enters the live router AS the calling
 * user (forwarding their cookie / bearer), never as a trusted service. Used by
 * the publish-time gate to verify the editor can actually READ every resource a
 * widget binds — "you cannot publish what you cannot see". Mirrors the AI
 * chat read-invoker; only the user's own auth headers are forwarded.
 */
export function createUserScopedRpcClient({
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

/** Extract ONLY the forwardable auth headers (cookie + bearer) from a request. */
export function forwardableAuthHeadersFrom(
  headers: Headers | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  const cookie = headers.get("cookie");
  if (cookie) out.cookie = cookie;
  const auth = headers.get("authorization");
  if (auth) out.authorization = auth;
  return out;
}
