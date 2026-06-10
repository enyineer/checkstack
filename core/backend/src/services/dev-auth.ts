import type { AuthService, RealUser } from "@checkstack/backend-api";
import { jwtService } from "./jwt";

/**
 * Dev-only auth service.
 *
 * Used by `bunx @checkstack/scripts dev` so plugin authors don't have to
 * deal with login flows / cookie state while iterating. Returns a
 * synthetic user that has every registered access rule, so any procedure
 * (regardless of the access guards on it) authorizes.
 *
 * IMPORTANT: real SERVICE tokens still resolve to a `ServiceUser`. dev-auth
 * REPLACES the core auth factory, so without this passthrough every
 * backend-to-backend call (and the service-only endpoints they hit, e.g.
 * `notification.registerSubscriptionSpec` from a plugin's `afterPluginsReady`)
 * would be authenticated as the synthetic USER and 403 with "for services
 * only" - which fatally breaks app boot. Only non-service requests get the
 * synthetic dev admin.
 *
 * NEVER register this in production. The runtime gates installation
 * behind a `CHECKSTACK_DEV_AUTH=true` env var that we set explicitly in
 * the dev server entry point.
 *
 * The user identity is stable (`dev-user`) so plugin code that derives
 * UI / data from `user.id` behaves consistently across reloads.
 *
 * Note: app-principal tokens (automation `runAs`) are NOT specially handled
 * here - in dev they fall through to the dev admin. That's a dev convenience;
 * the bounded-principal enforcement is covered by unit/integration tests.
 */
export function createDevAuthService({
  getAllAccessRules,
  pluginId,
}: {
  getAllAccessRules: () => Array<{ id: string }>;
  /**
   * The plugin this auth instance is scoped to (from the service-factory
   * metadata). Used to mint S2S credentials as `{ service: pluginId }`, so
   * service-only endpoints that check the caller's plugin (e.g. subscription
   * spec ownership) accept the call - exactly like the production auth factory.
   */
  pluginId: string;
}): AuthService {
  const devUser: RealUser = {
    type: "user",
    id: "dev-user",
    email: "dev@checkstack.local",
    name: "Dev User",
    accessRules: [], // populated lazily below
    roles: ["admin"],
    teamIds: [],
  };

  return {
    async authenticate(request) {
      // Honor real service tokens so backend-to-backend calls (and the
      // service-only endpoints they hit during boot) keep working.
      const token = request.headers.get("Authorization")?.replace("Bearer ", "");
      if (token) {
        const payload = await jwtService.verify(token);
        if (payload && payload.service) {
          return { type: "service" as const, pluginId: payload.service as string };
        }
      }
      // Otherwise authenticate as the synthetic dev admin. Grant every access
      // rule the platform currently knows about, resolved lazily so rules
      // registered by plugins after auth construction still apply.
      devUser.accessRules = getAllAccessRules().map((r) => r.id);
      return devUser;
    },
    async getCredentials() {
      // Mint a real service token (as THIS plugin) so backend-to-backend calls
      // authenticate as a SERVICE and pass service-only endpoints - including
      // those that check the caller's plugin id (e.g. subscription-spec
      // ownership) - matching production. Without this, S2S calls would carry
      // no auth, be treated as the synthetic user, and 403 on service-only
      // procedures (breaking boot).
      const token = await jwtService.sign({ service: pluginId }, "5m");
      return { headers: { Authorization: `Bearer ${token}` } };
    },
    async getAnonymousAccessRules() {
      // Anonymous users get nothing; the dev user is the only authenticated
      // identity in dev mode.
      return [];
    },
    async check() {
      return { hasAccess: true };
    },
    async listAccessibleObjectIds({ objectIds }) {
      return objectIds;
    },
    async hasAnyTypeGrant() {
      // The dev user is implicitly all-powerful; never categorically denied.
      return { hasGrant: true };
    },
    async authorizeCreate() {
      // Dev user has global manage; create globally with no owning team.
      return { ownerTeamId: null, isPrivate: false };
    },
    async setOwner() {
      // No team store in dev mode; ownership is a no-op.
    },
  };
}
