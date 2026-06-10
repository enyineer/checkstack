import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { AuthService, AuthUser } from "@checkstack/backend-api";
import { createMcpRequestHandler } from "./server";
import type { McpExecutableTool } from "./server";
import { createAiToolResolver } from "../resolver";
import { createAiToolRegistry } from "../tool-registry";
import type { McpToolInvoker } from "./tool-invoker";
import { createMcpConnectionRegistry } from "./connection-registry";
import type { RegisteredAiTool } from "../tool-registry";

function readTool(name: string, rule: string): RegisteredAiTool {
  return {
    name,
    description: `${name} (read-only)`,
    effect: "read",
    input: z.object({}),
    requiredAccessRules: [rule],
    execute: () => Promise.resolve({}),
  };
}

function mutateTool(name: string, rule: string): RegisteredAiTool {
  return {
    name,
    description: `${name} (mutating)`,
    effect: "mutate",
    input: z.object({}),
    requiredAccessRules: [rule],
    execute: () => Promise.resolve({}),
  };
}

function buildHandler({
  principal,
  invoke,
  enforceBudget,
  recordExecuted,
}: {
  principal: AuthUser | undefined;
  invoke?: McpToolInvoker["invoke"];
  enforceBudget?: (p: { kind: string; id: string }) => Promise<void>;
  recordExecuted?: (args: {
    principal: { kind: string; id: string };
    toolName: string;
    argsHash: string;
  }) => Promise<void>;
}) {
  const registry = createAiToolRegistry();
  const incidentTool = readTool("incident_list", "incident.incident.read");
  const adminTool = readTool("ai_secrets", "ai.tools.manage");
  // A mutating tool the limited principal IS allowed for (same access rule as
  // incident.list). The ONLY thing that may refuse a bare tools/call for it is
  // the structural effect-gate, not the resolver.
  const mutating = mutateTool("incident_close", "incident.incident.read");
  registry.register(incidentTool);
  registry.register(adminTool);
  registry.register(mutating);
  const resolver = createAiToolResolver({ registry });

  const tools: McpExecutableTool[] = [
    { tool: incidentTool, pluginId: "incident", procedureKey: "listIncidents" },
    { tool: adminTool, pluginId: "ai", procedureKey: "secrets" },
    { tool: mutating, pluginId: "incident", procedureKey: "closeIncident" },
  ];

  const invoker: McpToolInvoker = {
    invoke: invoke ?? (() => Promise.resolve({ ok: true })),
  };

  const auth: AuthService = {
    authenticate: () => Promise.resolve(principal),
    getCredentials: () => Promise.resolve({ headers: {} }),
    getAnonymousAccessRules: () => Promise.resolve([]),
    check: () => Promise.resolve(false),
  } as unknown as AuthService;

  return createMcpRequestHandler({
    tools,
    resolver,
    invoker,
    auth,
    connections: createMcpConnectionRegistry(),
    enforceBudget,
    recordExecuted,
  });
}

function mcpPost(body: unknown, token = "opaque-token"): Request {
  return new Request("http://localhost/api/ai/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

const limitedPrincipal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["incident.incident.read"],
};

describe("MCP server (read-only Streamable-HTTP)", () => {
  test("initialize returns protocol version + a session id header", async () => {
    const handler = buildHandler({ principal: limitedPrincipal });
    const res = await handler(
      mcpPost({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    );
    const json = await res.json();
    expect(json.result.protocolVersion).toBeDefined();
    expect(res.headers.get("mcp-session-id")).toBeTruthy();
  });

  test("tools/list only surfaces tools the principal may call", async () => {
    const handler = buildHandler({ principal: limitedPrincipal });
    const res = await handler(
      mcpPost({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    );
    const json = await res.json();
    const names = json.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(["incident_list"]);
    expect(names).not.toContain("ai_secrets");
  });

  test("tools/list returns 401 for an unauthenticated caller", async () => {
    const handler = buildHandler({ principal: undefined });
    const res = await handler(
      mcpPost({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
    );
    expect(res.status).toBe(401);
  });

  // Matrix #8: an MCP call for a tool OUTSIDE the token's scopes is rejected,
  // not just hidden — handler-side authz holds when the model misbehaves.
  test("tools/call for an out-of-scope tool is REFUSED (not merely hidden)", async () => {
    let invoked = false;
    const handler = buildHandler({
      principal: limitedPrincipal,
      invoke: () => {
        invoked = true;
        return Promise.resolve({});
      },
    });
    // The model names a tool the principal lacks the rule for.
    const res = await handler(
      mcpPost({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "ai_secrets", arguments: {} },
      }),
    );
    expect(res.status).toBe(403);
    // Crucially: the live router was NEVER re-entered for a forbidden tool.
    expect(invoked).toBe(false);
  });

  test("tools/call for an allowed tool re-enters the router with the bearer token", async () => {
    let seenToken: string | undefined;
    let seenRoute: string | undefined;
    const handler = buildHandler({
      principal: limitedPrincipal,
      invoke: ({ bearerToken, pluginId, procedureKey, input }) => {
        seenToken = bearerToken;
        seenRoute = `${pluginId}.${procedureKey}`;
        return Promise.resolve({ echoed: input });
      },
    });
    const res = await handler(
      mcpPost(
        {
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: { name: "incident_list", arguments: { status: "open" } },
        },
        "tok-123",
      ),
    );
    const json = await res.json();
    expect(json.result.isError).toBe(false);
    // The caller's own token is forwarded so the router re-checks authz live.
    expect(seenToken).toBe("tok-123");
    expect(seenRoute).toBe("incident.listIncidents");
  });

  // P2 review fix: the read-only-over-MCP guarantee is STRUCTURAL. Even when
  // the principal IS authorized for a mutating tool, a bare tools/call must be
  // refused with 403 and the live router must never be re-entered — mutating
  // tools go through propose/apply, never a direct invocation.
  test("tools/call for a mutating tool is structurally REFUSED even when authorized", async () => {
    let invoked = false;
    const handler = buildHandler({
      principal: limitedPrincipal,
      invoke: () => {
        invoked = true;
        return Promise.resolve({});
      },
    });
    const res = await handler(
      mcpPost({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "incident_close", arguments: {} },
      }),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error.message).toContain("propose/apply");
    expect(invoked).toBe(false);
  });

  test("tools/list excludes mutating tools (only the read-only surface)", async () => {
    const handler = buildHandler({ principal: limitedPrincipal });
    const res = await handler(
      mcpPost({ jsonrpc: "2.0", id: 8, method: "tools/list" }),
    );
    const json = await res.json();
    const names = json.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("incident_list");
    expect(names).not.toContain("incident_close");
  });

  // §14.5: per-principal tool budget enforced on tools/call (shared-Postgres).
  test("tools/call over the per-principal budget returns 429 and never invokes", async () => {
    let invoked = false;
    const handler = buildHandler({
      principal: limitedPrincipal,
      invoke: () => {
        invoked = true;
        return Promise.resolve({});
      },
      enforceBudget: () => Promise.reject(new Error("budget exceeded")),
    });
    const res = await handler(
      mcpPost({
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "incident_list", arguments: {} },
      }),
    );
    expect(res.status).toBe(429);
    expect(invoked).toBe(false);
  });

  test("a within-budget tools/call records an audit row (matrix #13)", async () => {
    const recorded: Array<{ toolName: string; argsHash: string }> = [];
    const handler = buildHandler({
      principal: limitedPrincipal,
      invoke: () => Promise.resolve({ ok: true }),
      enforceBudget: () => Promise.resolve(),
      recordExecuted: ({ toolName, argsHash }) => {
        recorded.push({ toolName, argsHash });
        return Promise.resolve();
      },
    });
    const res = await handler(
      mcpPost({
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: { name: "incident_list", arguments: { status: "open" } },
      }),
    );
    expect(res.status).toBe(200);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.toolName).toBe("incident_list");
    // The args hash is a SHA-256 hex digest, never the raw args.
    expect(recorded[0]?.argsHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("unknown method returns a JSON-RPC method-not-found error", async () => {
    const handler = buildHandler({ principal: limitedPrincipal });
    const res = await handler(
      mcpPost({ jsonrpc: "2.0", id: 6, method: "bogus/method" }),
    );
    const json = await res.json();
    expect(json.error.code).toBe(-32601);
  });
});
