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

function mcpPost(
  body: unknown,
  opts: { token?: string; sessionId?: string; origin?: string } = {},
): Request {
  const { token = "opaque-token", sessionId, origin } = opts;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  if (origin) headers.origin = origin;
  return new Request("http://localhost/api/ai/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

/**
 * Drive `initialize` and return the minted `mcp-session-id`. Post-initialize
 * requests (`tools/list` / `tools/call`) must echo this id or be refused, so
 * tests open a session here first.
 */
async function openSession(
  handler: (req: Request) => Promise<Response>,
  token = "opaque-token",
): Promise<string> {
  const res = await handler(
    mcpPost({ jsonrpc: "2.0", id: 0, method: "initialize" }, { token }),
  );
  const sessionId = res.headers.get("mcp-session-id");
  if (!sessionId) throw new Error("initialize did not mint a session id");
  return sessionId;
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
    const sessionId = await openSession(handler);
    const res = await handler(
      mcpPost({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { sessionId }),
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
    const sessionId = await openSession(handler);
    // The model names a tool the principal lacks the rule for.
    const res = await handler(
      mcpPost(
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "ai_secrets", arguments: {} },
        },
        { sessionId },
      ),
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
    const sessionId = await openSession(handler, "tok-123");
    const res = await handler(
      mcpPost(
        {
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: { name: "incident_list", arguments: { status: "open" } },
        },
        { token: "tok-123", sessionId },
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
    const sessionId = await openSession(handler);
    const res = await handler(
      mcpPost(
        {
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: { name: "incident_close", arguments: {} },
        },
        { sessionId },
      ),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error.message).toContain("propose/apply");
    expect(invoked).toBe(false);
  });

  test("tools/list excludes mutating tools (only the read-only surface)", async () => {
    const handler = buildHandler({ principal: limitedPrincipal });
    const sessionId = await openSession(handler);
    const res = await handler(
      mcpPost({ jsonrpc: "2.0", id: 8, method: "tools/list" }, { sessionId }),
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
    const sessionId = await openSession(handler);
    const res = await handler(
      mcpPost(
        {
          jsonrpc: "2.0",
          id: 9,
          method: "tools/call",
          params: { name: "incident_list", arguments: {} },
        },
        { sessionId },
      ),
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
    const sessionId = await openSession(handler);
    const res = await handler(
      mcpPost(
        {
          jsonrpc: "2.0",
          id: 10,
          method: "tools/call",
          params: { name: "incident_list", arguments: { status: "open" } },
        },
        { sessionId },
      ),
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

describe("MCP server conformance (Phase 4)", () => {
  test("initialize echoes a protocol version the client negotiated", async () => {
    const handler = buildHandler({ principal: limitedPrincipal });
    const res = await handler(
      mcpPost({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26" },
      }),
    );
    const json = await res.json();
    // The client asked for a version we support, so we echo it back.
    expect(json.result.protocolVersion).toBe("2025-03-26");
  });

  test("initialize falls back to our version for an unknown negotiated version", async () => {
    const handler = buildHandler({ principal: limitedPrincipal });
    const res = await handler(
      mcpPost({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "1999-01-01" },
      }),
    );
    const json = await res.json();
    expect(json.result.protocolVersion).toBe("2025-06-18");
  });

  test("tools/list WITHOUT a session id is refused (404, -32000)", async () => {
    const handler = buildHandler({ principal: limitedPrincipal });
    const res = await handler(
      mcpPost({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    );
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe(-32000);
  });

  test("tools/call with an UNKNOWN session id is refused (404, -32000) and never invokes", async () => {
    let invoked = false;
    const handler = buildHandler({
      principal: limitedPrincipal,
      invoke: () => {
        invoked = true;
        return Promise.resolve({});
      },
    });
    const res = await handler(
      mcpPost(
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "incident_list", arguments: {} },
        },
        { sessionId: "00000000-0000-0000-0000-000000000000" },
      ),
    );
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe(-32000);
    expect(invoked).toBe(false);
  });

  test("a cross-site Origin is refused with 403 before any work", async () => {
    const handler = buildHandler({ principal: limitedPrincipal });
    const res = await handler(
      mcpPost(
        { jsonrpc: "2.0", id: 4, method: "initialize" },
        { origin: "https://evil.example.com" },
      ),
    );
    expect(res.status).toBe(403);
  });

  test("malformed JSON yields a JSON-RPC parse error (400, -32700)", async () => {
    const handler = buildHandler({ principal: limitedPrincipal });
    const req = new Request("http://localhost/api/ai/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer opaque-token",
      },
      body: "{ not valid json",
    });
    const res = await handler(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe(-32700);
  });

  test("tools/list includes outputSchema for a tool that declares output", async () => {
    const registry = createAiToolRegistry();
    const withOutput: RegisteredAiTool = {
      name: "system_issues",
      description: "issues (read-only)",
      effect: "read",
      input: z.object({}),
      output: z.object({ count: z.number() }),
      requiredAccessRules: ["incident.incident.read"],
      execute: () => Promise.resolve({ count: 0 }),
    };
    registry.register(withOutput);
    const resolver = createAiToolResolver({ registry });
    const auth: AuthService = {
      authenticate: () => Promise.resolve(limitedPrincipal),
      getCredentials: () => Promise.resolve({ headers: {} }),
      getAnonymousAccessRules: () => Promise.resolve([]),
      check: () => Promise.resolve(false),
    } as unknown as AuthService;
    const handler = createMcpRequestHandler({
      tools: [
        { tool: withOutput, pluginId: "system", procedureKey: "issues" },
      ],
      resolver,
      invoker: { invoke: () => Promise.resolve({ count: 3 }) },
      auth,
      connections: createMcpConnectionRegistry(),
    });

    const sessionId = await openSession(handler);
    const listRes = await handler(
      mcpPost({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { sessionId }),
    );
    const listJson = await listRes.json();
    const descriptor = listJson.result.tools.find(
      (t: { name: string }) => t.name === "system_issues",
    );
    expect(descriptor.outputSchema).toBeDefined();
    expect(descriptor.outputSchema.type).toBe("object");

    // tools/call returns structuredContent alongside the text block.
    const callRes = await handler(
      mcpPost(
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "system_issues", arguments: {} },
        },
        { sessionId },
      ),
    );
    const callJson = await callRes.json();
    expect(callJson.result.structuredContent).toEqual({ count: 3 });
    expect(callJson.result.isError).toBe(false);
  });

  test("a tool with NO declared output omits structuredContent", async () => {
    const handler = buildHandler({
      principal: limitedPrincipal,
      invoke: () => Promise.resolve({ rows: [] }),
    });
    const sessionId = await openSession(handler);
    const res = await handler(
      mcpPost(
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "incident_list", arguments: {} },
        },
        { sessionId },
      ),
    );
    const json = await res.json();
    expect(json.result.structuredContent).toBeUndefined();
    expect("content" in json.result).toBe(true);
  });
});
