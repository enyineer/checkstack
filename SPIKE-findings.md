# Phase 2 SPIKE findings — better-auth `oidcProvider` + `mcp` (§11)

> **Outcome: DIVERGED — STOP.** The spike found a material divergence from the
> plan on two of the three named blocking conditions (opaque-only tokens AND no
> mint-time claims hook to embed/narrow scopes), plus a third compounding fact
> (the AS plugin is deprecated at the installed version). Per the handoff's
> explicit STOP instruction, Phase 2 implementation was NOT started. The P1
> review fixes were completed and committed separately (they are independent of
> the spike). This note records exactly what was probed, against what, and what
> blocks the design.

## What was probed and against what

- **Installed version (the actual fact that matters):** `better-auth` is pinned
  `^1.4.7` in both `core/auth-backend/package.json` and `core/backend/package.json`,
  but `bun install` resolves it to **`better-auth@1.6.4`** (verified in the bun
  store at `node_modules/.bun/better-auth@1.6.4+5bb339bc80ccb400/node_modules/better-auth`,
  `package.json` `"version": "1.6.4"`). The plan (§11, §2) assumes the API surface
  of 1.4.7; the spike was run against the genuinely-installed 1.6.4 typings and
  compiled source, as instructed.
- Both `oidc-provider` and `mcp` plugins exist at 1.6.4
  (`dist/plugins/oidc-provider/`, `dist/plugins/mcp/`) and are mutually
  compatible (the `mcp` plugin imports `OIDCOptions`/`OAuthAccessToken` from
  `oidc-provider` and re-uses the same `oauthAccessToken`/`oauthApplication`/
  `oauthConsent` schema).
- Read both `index.d.mts` typings and the compiled `index.mjs` for each plugin.

## (a) Are access tokens JWT (offline-introspectable) or opaque? — OPAQUE

**Opaque. Confirmed in the impl, not inferred from docs.**

In `dist/plugins/oidc-provider/index.mjs` the access token is generated as a
random string at both issuance sites:

```js
// line 431 (authorization_code grant) and line 536 (refresh_token grant)
const accessToken = generateRandomString(32, "a-z", "A-Z");
```

It is then persisted to the `oauthAccessToken` DB row
(`{ accessToken, refreshToken, accessTokenExpiresAt, clientId, userId, scopes }`,
schema in `oidc-provider/index.d.mts`). The only `SignJWT` call in the whole
plugin (line 622) signs the **id_token** (HS256, with the client secret), never
the access token. There is no JWT access-token mode and no `useJWTPlugin`-style
switch for the access token.

**Validation is therefore a DB introspection round-trip per call.** The `mcp`
plugin's `withMcpAuth(auth, handler)` hands the handler an `OAuthAccessToken`
**DB row** obtained via `getMcpSession` (`/mcp/get-session`, `requireHeaders:
true`), i.e. a `findOne` on the `oauthAccessToken` table for every protected MCP
request:

```ts
// mcp/index.d.mts
declare const withMcpAuth: <Auth>(
  auth: Auth,
  handler: (req: Request, session: OAuthAccessToken) => Response | Promise<Response>,
) => (req: Request) => Promise<Response>;
```

**Impact:** §6.2 of the plan specifies `verifyOAuthAccessToken(token)` as a
JWKS-verify of a JWT access token, with the heads-up in §20 that an opaque-only
outcome "changes the verification cost profile (an introspection round-trip per
call vs a local JWKS verify) ... Note for review once the spike lands." This is
exactly that case: **every** MCP tool call (and every internal Bearer-JWT
branch validation in §6.1) costs a Postgres round-trip. That is a per-call cost
profile the maintainer must sign off on before we wire it. (The §6 branch design
abstracts behind `verifyOAuthAccessToken`, so it *can* absorb introspection, but
the cost change is a maintainer decision, not an implementer one.)

## (b) Can the claims hook embed NARROWED scopes into the token? — NO (for the access token, as designed)

**No mint-time access-token claims hook exists.** The only claims-customization
callback on `OIDCOptions` is:

```ts
getAdditionalUserInfoClaim?: (
  user: User & Record<string, any>,
  scopes: string[],
  client: Client,
) => Record<string, any> | Promise<Record<string, any>>;
```

Its own docstring says it "applies to the `userinfo` endpoint and the
`id_token`." Confirmed in the impl: it is invoked only at id_token assembly
(line 572) and the userinfo endpoint (line 735) — **never** on the access token.

The access token carries no claims at all (it is a random string; §a). The
granted scopes are persisted verbatim on the `oauthAccessToken.scopes` text
field, set to the **requested** scopes granted at consent. There is **no
issuance hook** anywhere in the token endpoint where the requested scopes could
be intersected with the bound principal's real `accessRules` + `teamIds` at mint
time (the §7.1 narrowing algorithm / §7.2 "exact claims hook").

**Impact:** the plan's core scope-narrowing seam (§7.2, §13) — "the narrowing
runs there [the claims hook], writing the custom claims `{ principal_kind,
scopes, team_ids, roles }` onto the access token" — has no corresponding API at
1.6.4. The narrowed claims cannot be embedded into the token, and there is no
mint-time hook to perform the intersection. (A workaround — narrowing at the
resource server using the introspected `oauthAccessToken.scopes` row instead of
at mint — is a *different architecture* from §6/§7/§13 and is exactly the kind of
improvisation the STOP instruction forbids without maintainer sign-off.)

## (c) MCP Streamable-HTTP surface + DCR + consent — present, but on the deprecated plugin

- **DCR:** `oidc-provider` exposes `POST /oauth2/register` gated by
  `allowDynamicClientRegistration?: boolean` (the admin toggle the plan wants);
  the `mcp` plugin adds `POST /mcp/register`. Present.
- **Consent:** `consentPage` / `getConsentHTML` options + `POST /oauth2/consent`
  endpoint. Present.
- **MCP transport:** the `mcp` plugin provides OAuth discovery
  (`/.well-known/oauth-authorization-server`,
  `/.well-known/oauth-protected-resource`), `/mcp/authorize`, `/mcp/token`,
  `/mcp/register`, `/mcp/get-session`, and the `withMcpAuth` wrapper. Note this
  plugin supplies the **OAuth/identity layer** for MCP; the actual
  Streamable-HTTP JSON-RPC message handler (initialize / tools-list / tools-call)
  is still ours to mount (via `pluginHttpHandlers`) behind `withMcpAuth`, as the
  plan assumed. That part is unaffected.

## (d) Compounding fact: the AS plugin is DEPRECATED at 1.6.4

`oidcProvider`'s typedoc in `oidc-provider/index.d.mts`:

```
@deprecated Use `@better-auth/oauth-provider` instead. This plugin will be
removed in the next major version.
@see https://www.better-auth.com/docs/plugins/oauth-provider
```

The replacement `@better-auth/oauth-provider` is **not installed** in the
workspace (the bun store has only `generic-oauth` and `oauth-proxy`, which are
client-side / proxy plugins, not an AS). So building Phase 2 on `oidcProvider`
means building on a plugin that is already deprecated and scheduled for removal,
and the recommended replacement would need to be evaluated/added first (its
token format + claims-hook surface is unknown and would require its own spike).

## Why this is a STOP (mapping to the handoff's explicit conditions)

The handoff said to STOP if the spike finds EITHER:

1. **opaque-only tokens (per-call introspection = cost-profile change the
   maintainer must sign off)** — **CONFIRMED (§a).**
2. **the claims hook cannot embed/narrow scopes as designed** — **CONFIRMED
   (§b).**

Both blocking conditions are independently true, and (§d) adds that the only
available AS plugin is deprecated and the planned 1.4.7 surface is not what is
actually installed (1.6.4). The handoff is explicit: "Do NOT improvise a design
around a blocked spike." So no Phase 2 wiring was attempted.

## What the maintainer needs to decide (Phase 2 unblock options)

These are options for the maintainer to choose between — NOT a chosen design:

1. **Accept opaque tokens + introspection-at-resource-server, drop the embedded
   claims model.** Narrow scopes at the resource server from the introspected
   `oauthAccessToken.scopes` row (intersect with the bound principal's live
   `accessRules`/`teamIds` at validate time, not at mint). This preserves the
   narrow-only invariant (the intersection still only shrinks) and keeps
   `autoAuthMiddleware` the single enforcement point, but it relocates the
   narrowing seam from §7.2 (mint) to §6.x (validate) and adds a per-call DB
   round-trip. Requires sign-off on the cost profile AND the seam relocation.
2. **Adopt `@better-auth/oauth-provider` (the non-deprecated replacement).**
   Add the dependency and re-run this spike against it — it may offer a JWT
   access-token mode and/or an access-token claims hook that restores the §6/§7
   design as written. Unknown until probed.
3. **Pin `better-auth` to an exact `1.4.x`** that the plan was written against
   and re-run the spike there, if (and only if) 1.4.7's `oidcProvider` actually
   had a JWT-access-token + access-token-claims hook the 1.6.4 one lacks. (Worth
   verifying before committing to this — the deprecation and opaque-token design
   may predate 1.4.7.)

## Files probed (for re-verification)

- `node_modules/.bun/better-auth@1.6.4+5bb339bc80ccb400/node_modules/better-auth/package.json`
- `.../dist/plugins/oidc-provider/types.d.mts` (`OIDCOptions`, `OAuthAccessToken`, `OIDCMetadata`)
- `.../dist/plugins/oidc-provider/index.d.mts` (endpoints, schema, options)
- `.../dist/plugins/oidc-provider/index.mjs` (token generation lines 431/536, SignJWT line 622, `getAdditionalUserInfoClaim` lines 572/735, introspection line 700+)
- `.../dist/plugins/mcp/index.d.mts` (`MCPOptions`, `withMcpAuth`, `getMcpSession`, discovery endpoints)
