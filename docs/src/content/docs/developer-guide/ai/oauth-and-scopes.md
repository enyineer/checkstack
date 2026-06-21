---
title: OAuth and scopes
description: Checkstack as an OAuth Authorization Server, the access-rule scope grammar and bundles, and the narrow-only introspection model that backs the MCP server.
---

Checkstack acts as its own OAuth 2.1 Authorization Server so external tooling (such as an MCP client) can obtain a token bound to a real Checkstack principal. A token can only ever narrow what that principal could already do in the UI, and the narrowing is re-evaluated live on every call. This page covers the AS wiring, the scope grammar, and the introspect-time narrowing model.

## Checkstack as an OAuth Authorization Server

The AS is the better-auth `oidcProvider` plus `mcp` first-party plugins, enabled in `core/auth-backend`. They are off by default and turned on via an admin setting (`ai.mcp-oauth.enabled`). When enabled, the AS provides:

- Authorization code flow with PKCE, a consent screen, and Dynamic Client Registration (DCR).
- The OAuth discovery documents under the better-auth mount (`/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`).
- Its own signing keys and JWKS for the ID token. The platform keystore is untouched.

> [!IMPORTANT]
> Access tokens are opaque, not JWTs. The AS issues a random token string and persists it (with its granted scopes) in the `oauth_access_token` table. There is no client-side signature to verify; a resource server validates a token by introspecting it. The `oidcProvider` plugin is functional but marked deprecated at better-auth 1.6.x; migrating to `@better-auth/oauth-provider` is a tracked follow-up.

## Scope grammar

A scope string is a fully-qualified access-rule ID, the same vocabulary the authorization middleware enforces (for example `incident.incident.read`). On top of that there is a thin, two-bundle umbrella layer:

- `checkstack:read` expands to every registered `*.read` rule.
- `checkstack:write` expands to every registered `*.read` and `*.manage` rule.

Bundles are expanded from the live access-rule catalog before any intersection, so a bundle can only ever narrow. They never drift, because they are derived from the catalog rather than a hand-maintained list.

```ts
import { narrowScopes, SCOPE_BUNDLE } from "@checkstack/auth-backend";

// checkstack:write granted, but the principal only holds incident.read:
narrowScopes({
  requested: [SCOPE_BUNDLE.write],
  principalRules: ["incident.incident.read"],
  catalog: ["incident.incident.read", "incident.incident.manage"],
});
// => ["incident.incident.read"]   (manage is dropped — the principal lacks it)
```

## The narrow-only model (introspect-time)

The single locked invariant is that a token can only narrow a principal, never widen it. The narrowing runs at the resource server, not at token-mint time, because opaque tokens carry no embeddable claims:

1. A request arrives with `Authorization: Bearer <opaque>`.
2. The token is introspected against the `oauth_access_token` table (a lookup plus an explicit expiry check), yielding the bound user id and the granted scopes.
3. The bound user is enriched to their current, live access rules and team memberships, exactly as a UI session would be.
4. The granted scopes (bundles expanded) are intersected with those live rules. The result is the principal's `accessRules` for this request.

```text
narrowed = expandBundles(grantedScopes) ∩ effectiveRules(liveRules)
```

Because this runs live on every call:

- A rule the principal has since lost is dropped on the very next call. There is no stale, frozen-claim window.
- An admin (`*`) can mint a token for any granted rule, but the token carries the concrete expanded set, never the bare `*` wildcard, so a leaked admin token is not a god-token.

The authorization middleware remains the single enforcement point. The OAuth branch only produces a narrowed principal; every handler re-checks authorization against it exactly as for any other caller.

## Dynamic Client Registration and rate-limiting

DCR (`POST /api/auth/mcp/register`) is gated by `ai.mcp-oauth.allowDynamicClientRegistration`. When open, it is throttled per client IP by a shared-Postgres fixed-window counter (the `ai_rate_limit` table), so the cap holds across all pods. An in-memory per-pod limiter would let N pods each allow the cap, defeating the limit; the Postgres counter is therefore locked as the implementation.

```ts
import { checkRateLimit } from "@checkstack/auth-backend";

const result = await checkRateLimit({
  db,
  key: `dcr:${clientIp}`,
  max: 5,
  windowSeconds: 3600,
});
if (!result.allowed) {
  // respond 429
}
```

Admins manage the toggle and limits through the `getMcpOAuthSettings` / `setMcpOAuthSettings` RPCs (gated by the auth strategies access rule). Changing the settings reloads the auth configuration so the plugins enable or disable accordingly.

## Related

The narrowed principal this page produces is consumed by the [MCP server](/checkstack/developer-guide/ai/mcp-server/) and filtered by the [tool registry](/checkstack/developer-guide/ai/tool-registry/) resolver. The narrow-only invariant is a named hardening assertion (it can never widen a principal) backed by a property/fuzz test in `core/auth-backend/src/scope-narrowing.test.ts`, and the DCR throttle is verified cross-pod in `core/auth-backend/src/dcr-ratelimit.it.test.ts`. See the [AI platform overview](/checkstack/developer-guide/ai/) for the full security model.
