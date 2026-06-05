---
title: MCP server
description: The read-only Checkstack MCP server over Streamable HTTP, its tool surface, the OAuth auth flow, and how the model is kept from bypassing authorization.
---

Checkstack exposes a Model Context Protocol (MCP) server so external tooling can call the same read-only tools the in-app agent uses. The server speaks Streamable HTTP (not the deprecated HTTP+SSE transport) and is mounted at `/api/ai/mcp`. Every tool call is authorized as the narrowed OAuth principal, server-side, so the model can never reach a tool its token does not allow.

## Transport and discovery

The endpoint is a JSON-RPC 2.0 handler over HTTP POST. It implements the read-only surface:

- `initialize` returns the protocol version and a session id (`Mcp-Session-Id` header).
- `tools/list` returns the tools the authenticated principal may call.
- `tools/call` invokes a tool and returns its result as a text content block.

OAuth discovery and registration live under the better-auth mount (see [OAuth and scopes](/checkstack/developer-guide/ai/oauth-and-scopes/)):

- `/.well-known/oauth-authorization-server`
- `/.well-known/oauth-protected-resource`
- `/api/auth/mcp/register` (Dynamic Client Registration)

## Auth flow

A client obtains an opaque OAuth access token (via the authorization code flow, after consent), then calls the MCP endpoint with `Authorization: Bearer <token>`. On every request:

1. The token is introspected and narrowed to a live principal (the narrow-only model).
2. `tools/list` is filtered by the resolver, so the client only ever sees tools the principal may call.
3. `tools/call` re-enters the live router as that principal, forwarding the same bearer token, so the handler re-checks authorization. The resolver gate also refuses an out-of-scope tool before re-entry.

> [!IMPORTANT]
> Authorization is enforced in the handler, never by the model. The model is treated as an untrusted caller that happens to be good at picking arguments. A `tools/call` for a tool outside the token's scopes is refused server-side, not merely hidden from `tools/list`.

### Read-only is structural

A bare `tools/call` may only ever run a `read`-effect tool. The handler checks the resolved tool's effect after the access gate: a `mutate` or `destructive` tool is refused with a 403 (JSON-RPC error) and the live router is never re-entered. Mutating tools are also excluded from `tools/list`, so the model never sees a tool it could only ever be refused. Mutating and destructive tools reach MCP only through the two-step [propose and apply](/checkstack/developer-guide/ai/propose-apply/) flow, where the single-use proposal token is the consent gate. This makes the read-only-over-MCP guarantee a property of the handler, independent of which tools happen to be registered.

## The read-only tool surface

The Phase 2 surface is the projected read-only tools: `incident.list`, `healthcheck.status`, and `anomaly.explain`. Each is a projection of an existing oRPC read procedure, so its input schema and access rules come straight from the source procedure and never drift.

## Connecting a client

Point any MCP client that supports OAuth and Streamable HTTP at the endpoint:

```bash
# 1. Discover the authorization server.
curl https://your-checkstack/.well-known/oauth-protected-resource

# 2. After the OAuth flow yields a token, list tools.
curl -X POST https://your-checkstack/api/ai/mcp \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# 3. Call a read-only tool.
curl -X POST https://your-checkstack/api/ai/mcp \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"incident.list","arguments":{}}}'
```

## State and scale

The only pod-local state is the live MCP connection registry, which tracks connections terminated on this pod for bookkeeping. It is never a source of truth: a principal's rights are re-derived from the durable OAuth token on every request, and the rate-limit counters and token state live in shared Postgres. So any pod answers the same way for the same token.

## Related

The MCP server resolves its tools through the [tool registry](/checkstack/developer-guide/ai/tool-registry/), authenticates via [OAuth and scopes](/checkstack/developer-guide/ai/oauth-and-scopes/), runs mutating tools only through [propose and apply](/checkstack/developer-guide/ai/propose-apply/), and shares its spine with the [internal chat](/checkstack/developer-guide/ai/chat/). The wire behaviour (initialize / tools-list / tools-call, an out-of-scope tool refused with 403 without re-entering the router, and a mutating tool refused by the structural effect-gate) is exercised by `core/ai-backend/src/mcp/server.test.ts` and the env-gated `core/ai-backend/src/mcp/mcp-conformance.it.test.ts`. See the [AI platform overview](/checkstack/developer-guide/ai/) for the full security model.
