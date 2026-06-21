import { randomUUID } from "node:crypto";
import { extractErrorMessage } from "@checkstack/common";
import {
  opaqueBearerToken,
  type AuthService,
  type AuthUser,
} from "@checkstack/backend-api";
import { serializeTools } from "../serializer";
import { hashToolArgs } from "../propose-apply/args-hash";
import type { AiToolResolver } from "../resolver";
import type { RegisteredAiTool } from "../tool-registry";
import type { McpToolInvoker } from "./tool-invoker";
import type { McpConnectionRegistry } from "./connection-registry";

/**
 * A read-only tool exposed over MCP, bound to the live oRPC procedure that
 * actually runs it. The `tool` carries the model-facing schema + the access
 * rules the resolver filters on; `pluginId` / `procedureKey` route the
 * `tools/call` re-entry through the live router (handler authz preserved).
 */
export interface McpExecutableTool {
  tool: RegisteredAiTool;
  pluginId: string;
  procedureKey: string;
}

const JSONRPC_VERSION = "2.0";
/** Protocol version we implement; echoed unless the client negotiates a known one. */
const MCP_PROTOCOL_VERSION = "2025-06-18";
/**
 * Protocol versions this server understands. When the client's `initialize`
 * `params.protocolVersion` is one of these, we echo it back (negotiation);
 * otherwise we answer with our own {@link MCP_PROTOCOL_VERSION}.
 */
const SUPPORTED_PROTOCOL_VERSIONS = new Set(["2025-06-18", "2025-03-26"]);
const MCP_SESSION_HEADER = "mcp-session-id";

/** JSON-RPC 2.0 + MCP error codes (named to avoid magic numbers). */
const RPC_PARSE_ERROR = -32_700;
const RPC_METHOD_NOT_FOUND = -32_601;
const RPC_INVALID_PARAMS = -32_602;
const RPC_UNAUTHORIZED = -32_001;
const RPC_FORBIDDEN = -32_003;
/** Missing/unknown `Mcp-Session-Id` on a post-initialize request (spec §session). */
const RPC_SESSION_INVALID = -32_000;
/** Custom application error for an exceeded per-principal tool budget (§14.5). */
const RPC_RATE_LIMITED = -32_010;

/** The subset of an AuthUser the budget keys on. */
interface BudgetPrincipal {
  kind: "user" | "application";
  id: string;
}

/**
 * Per-principal tool-budget enforcer (§14.5). Resolves when the call is within
 * budget; rejects with a {@link Error} when over budget. Optional so the
 * handler stays testable without a Postgres connection.
 */
export type McpBudgetEnforcer = (
  principal: BudgetPrincipal,
) => Promise<void>;

/** Records a directly-executed read tool call into the audit log (optional). */
export type McpRecordExecuted = (args: {
  principal: BudgetPrincipal;
  toolName: string;
  argsHash: string;
}) => Promise<void>;

interface JsonRpcRequest {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type JsonRpcId = string | number | null;

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: JSONRPC_VERSION, id, error: { code, message } };
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, {
    status: init?.status ?? 200,
    headers: init?.headers,
  });
}

/**
 * Negotiate the protocol version from the client's `initialize` params: echo a
 * version we support, otherwise answer with our own. A non-string or unknown
 * value falls back to {@link MCP_PROTOCOL_VERSION} (we never fail initialize on
 * version alone — the client adapts to what we return).
 */
function negotiateProtocolVersion(params: Record<string, unknown> | undefined): string {
  const requested = params?.protocolVersion;
  if (typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.has(requested)) {
    return requested;
  }
  return MCP_PROTOCOL_VERSION;
}

/**
 * `Origin` guard (Streamable-HTTP security note). A browser attaches `Origin` to
 * cross-site requests; a server-to-server MCP client omits it. We therefore
 * reject ONLY when an `Origin` is present AND its host differs from the request
 * host (a cross-site browser request to a server-to-server endpoint). A missing
 * `Origin` is allowed (the normal MCP client case). Returns true when the
 * request should be refused.
 */
function isForbiddenOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== new URL(req.url).host;
  } catch {
    // A malformed Origin header is treated as hostile.
    return true;
  }
}

/**
 * Build the Streamable-HTTP MCP request handler (decision §9 — Streamable HTTP,
 * NOT the deprecated HTTP+SSE). Handles the read-only surface: `initialize`,
 * `tools/list`, `tools/call`, and the `notifications/initialized` ack.
 *
 * Authentication: the bearer OAuth token is resolved to a NARROWED principal by
 * the platform auth strategy (`auth.authenticate` → the Bearer-OAuth branch).
 * Tool visibility is filtered by the resolver (the principal only sees tools it
 * may call); `tools/call` re-enters the live router as that principal so the
 * handler re-checks authz. The model never bypasses authorization.
 */
export function createMcpRequestHandler({
  tools,
  resolver,
  invoker,
  auth,
  connections,
  enforceBudget,
  recordExecuted,
}: {
  tools: McpExecutableTool[];
  resolver: AiToolResolver;
  invoker: McpToolInvoker;
  auth: AuthService;
  connections: McpConnectionRegistry;
  /** Per-principal tool-budget enforcer (§14.5). Refuses over-budget calls. */
  enforceBudget?: McpBudgetEnforcer;
  /** Audit-record a directly-executed read tool (matrix #13). */
  recordExecuted?: McpRecordExecuted;
}): (req: Request) => Promise<Response> {
  // Built lazily on first request: the `tools` array is populated in
  // `afterPluginsReady` (once every plugin has exposed its read projections),
  // which runs AFTER this handler is created in init. Requests only arrive after
  // that phase, so the first request sees the complete set.
  let byName: Map<string, McpExecutableTool> | undefined;

  return async function handleMcpRequest(req: Request): Promise<Response> {
    byName ??= new Map(tools.map((t) => [t.tool.name, t]));
    if (req.method === "GET") {
      // No server-initiated SSE stream for the read-only surface; clients use
      // POST request/response. (A GET opens an SSE channel in full MCP; not
      // needed for read-only tools.)
      return new Response(null, { status: 405 });
    }
    if (req.method !== "POST") {
      return new Response(null, { status: 405 });
    }
    // ORIGIN GUARD (Streamable-HTTP security note): refuse a cross-site browser
    // request before doing any work. A normal server-to-server MCP client omits
    // `Origin`, so this never affects them.
    if (isForbiddenOrigin(req)) {
      return jsonResponse(rpcError(null, RPC_FORBIDDEN, "Forbidden origin"), {
        status: 403,
      });
    }

    const bearerToken = opaqueBearerToken(req);
    const principal: AuthUser | undefined = await auth.authenticate(req);
    const sessionHeader = req.headers.get(MCP_SESSION_HEADER) ?? undefined;

    let payload: JsonRpcRequest;
    try {
      payload = (await req.json()) as JsonRpcRequest;
    } catch {
      return jsonResponse(rpcError(null, RPC_PARSE_ERROR, "Parse error"), {
        status: 400,
      });
    }

    const id = payload.id ?? null;

    /**
     * Require + validate the `Mcp-Session-Id` on a POST-initialize request. The
     * id is minted by `initialize` and tracked in the (pod-local) connection
     * registry; a request that omits it, or carries one this pod did not mint,
     * is refused with a `404` + JSON-RPC `-32000`. Returns a `Response` to send
     * (the refusal) or `undefined` when the session is valid. Skipped before a
     * principal exists (auth refuses first) so the session check only gates
     * authenticated, post-initialize traffic.
     */
    const sessionRefusal = (): Response | undefined => {
      if (!sessionHeader || !connections.get(sessionHeader)) {
        return jsonResponse(
          rpcError(
            id,
            RPC_SESSION_INVALID,
            "Missing or unknown Mcp-Session-Id; call initialize first and echo the returned session id.",
          ),
          { status: 404 },
        );
      }
      return undefined;
    };

    switch (payload.method) {
      case "initialize": {
        // A fresh session id is minted and tracked pod-locally (bookkeeping).
        const sessionId = randomUUID();
        if (principal) {
          connections.open({
            sessionId,
            principalId: "id" in principal ? principal.id : "unknown",
          });
        }
        return jsonResponse(
          rpcResult(id, {
            // Negotiated: echo the client's requested version when we support
            // it, else fall back to ours.
            protocolVersion: negotiateProtocolVersion(payload.params),
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "checkstack", version: "1.0.0" },
          }),
          { headers: { [MCP_SESSION_HEADER]: sessionId } },
        );
      }

      case "notifications/initialized": {
        // Notification: no response body (id is absent). Still require a valid
        // session so the lifecycle is enforced, not cosmetic.
        if (!sessionHeader || !connections.get(sessionHeader)) {
          return new Response(null, { status: 404 });
        }
        return new Response(null, { status: 202 });
      }

      case "tools/list": {
        if (!principal) {
          return jsonResponse(rpcError(id, RPC_UNAUTHORIZED, "Unauthorized"), {
            status: 401,
          });
        }
        const invalid = sessionRefusal();
        if (invalid) return invalid;
        // Only read-effect tools are listed: the read-only MCP surface invokes
        // tools via a bare `tools/call`, which the structural effect-gate
        // refuses for mutate/destructive tools. Listing a tool that could only
        // ever be refused would mislead the model, so they are filtered here
        // (the propose/apply flow surfaces mutating tools separately).
        const allowed = resolver
          .resolveTools(principal)
          .filter((tool) => tool.effect === "read");
        const descriptors = serializeTools({ tools: allowed }).map((d) => ({
          name: d.name,
          description: d.description,
          inputSchema: d.inputSchema,
          // MCP 2025-06-18 `outputSchema`: the serializer already produces it for
          // any tool that declares an `output` schema, so the model can reason
          // about the result shape before calling. Omitted when the tool declares
          // no output (do not emit an `undefined` field on the wire).
          ...(d.outputSchema ? { outputSchema: d.outputSchema } : {}),
        }));
        return jsonResponse(rpcResult(id, { tools: descriptors }));
      }

      case "tools/call": {
        if (!principal || !bearerToken) {
          return jsonResponse(rpcError(id, RPC_UNAUTHORIZED, "Unauthorized"), {
            status: 401,
          });
        }
        const invalid = sessionRefusal();
        if (invalid) return invalid;
        const name = payload.params?.name;
        if (typeof name !== "string") {
          return jsonResponse(
            rpcError(id, RPC_INVALID_PARAMS, "Invalid params: missing tool name"),
          );
        }
        const executable = byName.get(name);
        if (!executable) {
          return jsonResponse(
            rpcError(id, RPC_INVALID_PARAMS, `Unknown tool: ${name}`),
          );
        }
        // Resolver gate: the model can only call a tool the principal may see.
        // (Handler-side authz is the authority and re-runs below; this gate
        // refuses a misbehaving model server-side BEFORE re-entry.)
        if (!resolver.isAllowed({ principal, tool: executable.tool })) {
          return jsonResponse(rpcError(id, RPC_FORBIDDEN, `Forbidden: ${name}`), {
            status: 403,
          });
        }
        // STRUCTURAL effect-gate (decision §1.6 / §8): a bare `tools/call` may
        // ONLY run a read-effect tool. Mutating / destructive tools MUST go
        // through the two-step propose -> apply flow (the proposal token is the
        // single-use consent gate), never a direct invocation. This makes the
        // read-only-over-MCP guarantee a structural property of the handler,
        // independent of which tools happen to be wired into `tools`.
        if (executable.tool.effect !== "read") {
          return jsonResponse(
            rpcError(
              id,
              RPC_FORBIDDEN,
              `Tool "${name}" has effect "${executable.tool.effect}" and cannot be invoked via tools/call; use the propose/apply flow.`,
            ),
            { status: 403 },
          );
        }
        const args =
          (payload.params?.arguments as Record<string, unknown>) ?? {};

        // Per-principal tool budget (§14.5): enforced BEFORE the call so an
        // over-budget caller is refused. Shared-Postgres counter — cross-pod
        // correct. The principal kind is "user" | "application" (services never
        // reach here: they have no access rules and the resolver gate refused).
        const budgetPrincipal: BudgetPrincipal | undefined =
          principal.type === "user" || principal.type === "application"
            ? { kind: principal.type, id: principal.id }
            : undefined;
        if (enforceBudget && budgetPrincipal) {
          try {
            await enforceBudget(budgetPrincipal);
          } catch (error) {
            return jsonResponse(
              rpcError(id, RPC_RATE_LIMITED, extractErrorMessage(error)),
              { status: 429 },
            );
          }
        }

        try {
          const result = await invoker.invoke({
            pluginId: executable.pluginId,
            procedureKey: executable.procedureKey,
            input: args,
            bearerToken,
          });
          // Audit-record the directly-executed read tool (matrix #13). The args
          // hash is recorded, never the raw args. Best-effort: an audit failure
          // must not fail the tool call.
          if (recordExecuted && budgetPrincipal) {
            await recordExecuted({
              principal: budgetPrincipal,
              toolName: name,
              argsHash: hashToolArgs(args),
            }).catch(() => {});
          }
          return jsonResponse(
            rpcResult(id, {
              content: [{ type: "text", text: JSON.stringify(result) }],
              // MCP 2025-06-18 `structuredContent`: when the tool declares an
              // `output` schema, return the parsed result alongside the text
              // block so a structured-output-aware client can consume it
              // directly (the `outputSchema` in tools/list describes its shape).
              // Omitted for tools with no declared output.
              ...(executable.tool.output
                ? { structuredContent: result }
                : {}),
              isError: false,
            }),
          );
        } catch (error) {
          // Surfaced as an MCP tool error (not a transport error), per spec.
          return jsonResponse(
            rpcResult(id, {
              content: [{ type: "text", text: extractErrorMessage(error) }],
              isError: true,
            }),
          );
        }
      }

      default: {
        return jsonResponse(
          rpcError(id, RPC_METHOD_NOT_FOUND, `Method not found: ${payload.method}`),
        );
      }
    }
  };
}
