import type { AuthService, RealUser } from "@checkstack/backend-api";

/**
 * Dev-only auth service.
 *
 * Used by `bunx @checkstack/scripts dev` so plugin authors don't have to
 * deal with login flows / cookie state while iterating. Returns a
 * synthetic user that has every registered access rule, so any procedure
 * (regardless of the access guards on it) authorizes.
 *
 * NEVER register this in production. The runtime gates installation
 * behind a `CHECKSTACK_DEV_AUTH=true` env var that we set explicitly in
 * the dev server entry point.
 *
 * The user identity is stable (`dev-user`) so plugin code that derives
 * UI / data from `user.id` behaves consistently across reloads.
 */
export function createDevAuthService({
  getAllAccessRules,
}: {
  getAllAccessRules: () => Array<{ id: string }>;
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
    async authenticate(_request) {
      // Always grant every access rule the platform currently knows about.
      // We resolve this lazily so rules registered by plugins after auth
      // construction (the normal flow) still apply.
      devUser.accessRules = getAllAccessRules().map((r) => r.id);
      return devUser;
    },
    async getCredentials() {
      return { headers: {} };
    },
    async getAnonymousAccessRules() {
      // Anonymous users get nothing; the dev user is the only authenticated
      // identity in dev mode.
      return [];
    },
    async checkResourceTeamAccess() {
      return { hasAccess: true };
    },
    async getAccessibleResourceIds({ resourceIds }) {
      return resourceIds;
    },
  };
}
