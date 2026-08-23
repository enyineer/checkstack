import { describe, expect, test } from "bun:test";

/**
 * MCP Streamable-HTTP wire conformance (matrix #9).
 *
 * Gated behind `CHECKSTACK_IT=1` so the default `bun test` never runs it. Drives
 * a REAL running backend's MCP endpoint over HTTP to validate the
 * initialize -> tools/list -> tools/call round-trip against a live, OAuth-token
 * authenticated session. Configure:
 * - `CHECKSTACK_IT_MCP_URL`   (defaults to http://localhost:3000/api/ai/mcp)
 * - `CHECKSTACK_IT_MCP_TOKEN` (a minted opaque OAuth access token, NARROWED to a
 *   read scope that does NOT include the admin incident rules — so `anomaly_list`
 *   is out of scope and mutating tools are not directly invocable)
 *
 * This is the only assertion that exercises the full opaque-token introspection
 * + live-router re-entry path end-to-end, so it lives as an integration test.
 * Phase 5 adds the negative wire assertions: an out-of-scope tool is refused
 * (and the router is never re-entered), and a mutating tool is refused by the
 * structural effect-gate (propose/apply only).
 */
const MCP_URL =
  process.env.CHECKSTACK_IT_MCP_URL ?? "http://localhost:3000/api/ai/mcp";
const MCP_TOKEN = process.env.CHECKSTACK_IT_MCP_TOKEN ?? "";
/** A tool the IT token's scope does NOT grant (admin-only). */
const OUT_OF_SCOPE_TOOL =
  process.env.CHECKSTACK_IT_MCP_OUT_OF_SCOPE_TOOL ?? "anomaly_list";
/** Optional projected mutating tool, when an integration environment exposes one. */
const MUTATING_TOOL = process.env.CHECKSTACK_IT_MCP_MUTATING_TOOL;

/**
 * Open an MCP session and return the minted `mcp-session-id`. Post-initialize
 * requests must echo this id or the server refuses them (Phase 4 session
 * enforcement), so every test that issues a `tools/list` / `tools/call` first
 * obtains a session here.
 */
async function openSession(): Promise<string> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${MCP_TOKEN}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
  });
  const sessionId = res.headers.get("mcp-session-id");
  if (!sessionId) throw new Error("initialize did not mint a session id");
  return sessionId;
}

async function rpc(
  body: unknown,
  sessionId?: string,
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${MCP_TOKEN}`,
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

// Requires a REAL running backend (CHECKSTACK_IT_MCP_URL) reachable with a
// minted, scope-narrowed OAuth token (CHECKSTACK_IT_MCP_TOKEN). The plain
// `CHECKSTACK_IT` PG/Redis integration lane does not stand up that backend, so
// gate on the token too - otherwise these tests fail with "Unable to connect"
// instead of skipping where the prerequisite isn't provided.
describe.skipIf(!process.env.CHECKSTACK_IT || !process.env.CHECKSTACK_IT_MCP_TOKEN)(
  "MCP Streamable-HTTP conformance",
  () => {
    test("initialize advertises a protocol version and a session id", async () => {
      const res = await fetch(MCP_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${MCP_TOKEN}`,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      });
      const json = (await res.json()) as {
        result?: { protocolVersion?: string };
      };
      expect(json.result?.protocolVersion).toBeTruthy();
      expect(res.headers.get("mcp-session-id")).toBeTruthy();
    });

    test("initialize echoes a negotiated protocol version", async () => {
      const res = await fetch(MCP_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${MCP_TOKEN}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-03-26" },
        }),
      });
      const json = (await res.json()) as {
        result?: { protocolVersion?: string };
      };
      expect(json.result?.protocolVersion).toBe("2025-03-26");
    });

    test("tools/list WITHOUT a session id is refused (session enforced, not cosmetic)", async () => {
      const { status, json } = (await rpc({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      })) as { status: number; json: { error?: { code?: number } } };
      expect(status).toBe(404);
      expect(json.error?.code).toBe(-32000);
    });

    test("tools/list returns the read-only tool surface", async () => {
      const sessionId = await openSession();
      const { json } = (await rpc(
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        sessionId,
      )) as {
        json: {
          result?: {
            tools?: Array<{ name: string; outputSchema?: unknown }>;
          };
        };
      };
      const tools = json.result?.tools ?? [];
      const names = tools.map((t) => t.name);
      // The principal must at least be able to list incidents in the IT env.
      expect(names).toContain("incident_list");
      // Projected read tools carry their source procedure's output schema.
      expect(tools.some((t) => t.outputSchema !== undefined)).toBe(true);
    });

    test("tools/call returns a non-error content block", async () => {
      const sessionId = await openSession();
      const { json } = (await rpc(
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "incident_list", arguments: {} },
        },
        sessionId,
      )) as { json: { result?: { isError?: boolean } } };
      expect(json.result?.isError).toBe(false);
    });

    test("tools/list never lists an out-of-scope tool", async () => {
      const sessionId = await openSession();
      const { json } = (await rpc(
        { jsonrpc: "2.0", id: 4, method: "tools/list" },
        sessionId,
      )) as { json: { result?: { tools?: Array<{ name: string }> } } };
      const names = (json.result?.tools ?? []).map((t) => t.name);
      // The narrowed token does not grant the admin rule, so the tool is hidden.
      expect(names).not.toContain(OUT_OF_SCOPE_TOOL);
      // A mutating tool is never on the read-only list either.
      if (MUTATING_TOOL) expect(names).not.toContain(MUTATING_TOOL);
    });

    test("tools/call for an out-of-scope tool is REFUSED 403 (not merely hidden)", async () => {
      const sessionId = await openSession();
      const { status, json } = (await rpc(
        {
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: { name: OUT_OF_SCOPE_TOOL, arguments: {} },
        },
        sessionId,
      )) as { status: number; json: { error?: { message?: string } } };
      // Handler-side authz holds when the model misbehaves: the resolver gate
      // refuses BEFORE the live router is re-entered.
      expect(status).toBe(403);
      expect(json.error?.message).toBeTruthy();
    });

    test.skipIf(!MUTATING_TOOL)(
      "tools/call for a mutating tool is refused by the structural effect-gate",
      async () => {
        if (!MUTATING_TOOL) return;
        const sessionId = await openSession();
        const { status, json } = (await rpc(
          {
            jsonrpc: "2.0",
            id: 6,
            method: "tools/call",
            params: { name: MUTATING_TOOL, arguments: {} },
          },
          sessionId,
        )) as { status: number; json: { error?: { message?: string } } };
        // A bare tools/call may only run a read tool; mutating tools MUST go
        // through propose/apply. The handler refuses with 403 and never executes.
        expect(status).toBe(403);
        expect(json.error?.message).toContain("propose/apply");
      },
    );
  },
);
