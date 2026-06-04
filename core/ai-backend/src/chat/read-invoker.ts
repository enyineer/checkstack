import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

/**
 * Runs a chat read-tool's SOURCE oRPC procedure by re-entering the live router
 * AS THE LOGGED-IN USER, so handler-side authorization runs exactly as for any
 * other caller (decision §1.5 — the model is an untrusted caller that merely
 * picks arguments; it never bypasses authz).
 *
 * Mirrors the MCP `tool-invoker`, but forwards the chat request's OWN auth
 * (session cookie and/or bearer) to the loopback endpoint instead of an OAuth
 * bearer. The API route re-authenticates that request to the SAME principal the
 * chat handler resolved, then runs `autoAuthMiddleware`. We deliberately do NOT
 * use the trusted service client (that would skip the user's authz).
 */
export interface ChatReadInvoker {
  invoke(args: {
    pluginId: string;
    procedureKey: string;
    input: unknown;
    /** Auth headers forwarded verbatim from the chat request (cookie/bearer). */
    forwardHeaders: Record<string, string>;
  }): Promise<unknown>;
}

type LoopbackClient = Record<
  string,
  Record<string, (input: unknown) => Promise<unknown>>
>;

export function createChatReadInvoker({
  internalUrl,
}: {
  internalUrl: string;
}): ChatReadInvoker {
  return {
    async invoke({ pluginId, procedureKey, input, forwardHeaders }) {
      const link = new RPCLink({
        url: `${internalUrl}/api`,
        headers: forwardHeaders,
      });
      const client = createORPCClient(link) as LoopbackClient;
      const pluginClient = client[pluginId];
      if (!pluginClient) {
        throw new Error(`No RPC client for plugin "${pluginId}".`);
      }
      const procedure = pluginClient[procedureKey];
      if (typeof procedure !== "function") {
        throw new TypeError(
          `Procedure "${pluginId}.${procedureKey}" is not callable.`,
        );
      }
      return procedure(input);
    },
  };
}

/**
 * Extract the auth headers to forward from the incoming chat request: the
 * session cookie and/or the bearer Authorization header. Only these are
 * forwarded — never arbitrary client headers.
 */
export function forwardableAuthHeaders(
  req: Request,
): Record<string, string> {
  const headers: Record<string, string> = {};
  const cookie = req.headers.get("cookie");
  if (cookie) headers.cookie = cookie;
  const auth = req.headers.get("authorization");
  if (auth) headers.authorization = auth;
  return headers;
}
