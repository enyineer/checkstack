import { eq } from "drizzle-orm";
import type { RealUser, SafeDatabase } from "@checkstack/backend-api";
import { narrowScopes } from "./scope-narrowing";
import * as schema from "./schema";

// Re-export the shared opaque-bearer extractor so existing import sites in this
// plugin (index.ts) keep working without changing their import path.
export { opaqueBearerToken } from "@checkstack/backend-api";

/**
 * The introspected OAuth session — the subset of better-auth's
 * `OAuthAccessToken` row this branch needs. Tokens are OPAQUE (decision §11):
 * this is the result of a DB introspection, not a decoded JWT.
 */
export interface IntrospectedOAuthSession {
  /** The bound principal's user id (`OAuthAccessToken.userId`). */
  userId: string;
  /** Space-delimited granted scopes (`OAuthAccessToken.scopes`). */
  scopes: string;
}

/**
 * Introspect an OPAQUE OAuth access token against the oidcProvider-owned
 * `oauthAccessToken` table (decision §11 — tokens are not JWTs, so this is a DB
 * lookup, the same `findOne` the mcp plugin's `getMcpSession` performs, plus an
 * explicit expiry check which `getMcpSession` does NOT do). Returns the session
 * subset, or `undefined` when the token is unknown or expired.
 */
export async function introspectOpaqueToken({
  db,
  token,
  now = new Date(),
}: {
  db: SafeDatabase<typeof schema>;
  token: string;
  now?: Date;
}): Promise<IntrospectedOAuthSession | undefined> {
  const rows = await db
    .select({
      userId: schema.oauthAccessToken.userId,
      scopes: schema.oauthAccessToken.scopes,
      expiresAt: schema.oauthAccessToken.accessTokenExpiresAt,
    })
    .from(schema.oauthAccessToken)
    .where(eq(schema.oauthAccessToken.accessToken, token))
    .limit(1);

  const row = rows[0];
  if (!row || !row.userId || !row.scopes) return undefined;
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= now.getTime()) {
    return undefined; // expired
  }
  return { userId: row.userId, scopes: row.scopes };
}

/**
 * The principal's LIVE rules + teams, resolved by the same machinery the UI
 * uses (`enrichUser`). Passed in so this module stays pure and DB-agnostic.
 */
export interface LivePrincipal {
  base: RealUser;
  /** All currently-registered qualified access-rule IDs (for bundle/admin expansion). */
  catalog: string[];
}

/**
 * Build a NARROWED principal from an introspected opaque OAuth token.
 *
 * The crux (decision 4, §6.3): enrich the bound user to their CURRENT full
 * access rules, then intersect with the token's granted scopes. Narrowing runs
 * live on every call, so a rule the principal has since lost is dropped on the
 * next call — strictly stronger than freezing claims into a JWT at mint.
 *
 * Returns `undefined` when the token has no granted scopes (it can do nothing,
 * so it is treated as unauthenticated rather than as a zero-rule principal).
 */
export function narrowedPrincipalFromSession({
  session,
  principal,
}: {
  session: IntrospectedOAuthSession;
  principal: LivePrincipal;
}): RealUser | undefined {
  const granted = session.scopes.split(" ").filter(Boolean);
  if (granted.length === 0) return undefined;

  const narrowedRules = narrowScopes({
    requested: granted,
    principalRules: principal.base.accessRules ?? [],
    catalog: principal.catalog,
  });

  // Narrow-only: accessRules is replaced by the (subset) narrowed set; teamIds
  // are inherited verbatim from the live enrichment.
  return {
    ...principal.base,
    accessRules: narrowedRules,
  };
}
