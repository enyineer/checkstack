import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RpcClient } from "@checkstack/backend-api";

/**
 * Build a USER-SCOPED `RpcClient` for an AI tool to call plugin procedures AS
 * THE ORIGINATING USER, never as a trusted service.
 *
 * The trusted `coreServices.rpcClient` injects a service JWT, and
 * `autoAuthMiddleware` SHORT-CIRCUITS all access-rule, single-resource, and
 * team-scope checks for service principals. So a tool calling the trusted client
 * would bypass the user's authorization and could read/mutate resources the user
 * cannot - a privilege-escalation path. Instead, this client re-enters the live
 * router at `/api` forwarding the user's OWN auth (session cookie and/or bearer),
 * so the procedure re-authenticates to the SAME principal and runs
 * `autoAuthMiddleware` (incl. per-resource/team `instanceAccess`) exactly as a
 * direct UI/RPC call would. It mirrors `createChatReadInvoker` /
 * `mcp/tool-invoker`, but presents the full typed `RpcClient.forPlugin(...)`
 * surface so a tool's `execute`/`dryRun` uses it transparently.
 *
 * IMPORTANT: only the user's forwardable auth headers (cookie / Authorization)
 * are forwarded - never arbitrary client headers and never the service JWT.
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
      // provided by the RpcClient interface (InferClient<T>).
      return (client as Record<string, unknown>)[def.pluginId] as never;
    },
  };
}

/**
 * Extract the forwardable auth headers from a `Headers` view (the oRPC handler
 * `context.requestHeaders` for the deferred applyTool/proposeTool path). Only the
 * session cookie and bearer Authorization are forwarded.
 */
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
