import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

/**
 * Invokes a projected read-only tool's SOURCE oRPC procedure by re-entering the
 * live router as the resolved principal, so handler-side authorization runs
 * exactly as it would for any other caller (decision 5 — the model never
 * bypasses authz; it is an untrusted caller that happens to pick arguments).
 *
 * The re-entry forwards the caller's OWN opaque OAuth bearer token to the
 * loopback RPC endpoint. The API route handler re-authenticates that token
 * through the Bearer-OAuth branch (introspect + narrow to the live principal)
 * and runs `autoAuthMiddleware`. So the tool call is authorized as the NARROWED
 * principal, server-side, on every call. We deliberately do NOT use the
 * service-credential `fetch` (that would call as a trusted service and skip the
 * user's authz).
 */
export interface McpToolInvoker {
  invoke(args: {
    /** The source procedure's owning plugin id (e.g. "incident"). */
    pluginId: string;
    /** The source procedure key (e.g. "listIncidents"). */
    procedureKey: string;
    /** Validated tool input. */
    input: unknown;
    /** The caller's opaque OAuth bearer token (forwarded verbatim). */
    bearerToken: string;
  }): Promise<unknown>;
}

/** A minimal typed view of the loopback RPC client (per-plugin, per-procedure). */
type LoopbackClient = Record<
  string,
  Record<string, (input: unknown) => Promise<unknown>>
>;

export function createMcpToolInvoker({
  internalUrl,
}: {
  /** Base URL of this backend for the loopback call (e.g. INTERNAL_URL). */
  internalUrl: string;
}): McpToolInvoker {
  return {
    async invoke({ pluginId, procedureKey, input, bearerToken }) {
      // A fresh link per call carries this caller's bearer token; the live
      // router re-checks authz as the narrowed principal.
      const link = new RPCLink({
        url: `${internalUrl}/api`,
        headers: { authorization: `Bearer ${bearerToken}` },
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
