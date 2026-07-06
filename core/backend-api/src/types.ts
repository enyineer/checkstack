import { ZodSchema } from "zod";
import { ClientDefinition, InferClient } from "@checkstack/common";

/**
 * The canonical `Logger` definition now lives in `@checkstack/common` so that
 * low-level packages (`@checkstack/cache-api`, `@checkstack/queue-api`) can
 * reference it without depending on `backend-api` and creating a publish-time
 * dependency cycle. Re-exported here for backward compatibility.
 */
export type { Logger } from "@checkstack/common";

export interface Fetch {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  forPlugin(pluginId: string): {
    fetch(path: string, init?: RequestInit): Promise<Response>;
    get(path: string, init?: RequestInit): Promise<Response>;
    post(path: string, body?: unknown, init?: RequestInit): Promise<Response>;
    put(path: string, body?: unknown, init?: RequestInit): Promise<Response>;
    patch(path: string, body?: unknown, init?: RequestInit): Promise<Response>;
    delete(path: string, init?: RequestInit): Promise<Response>;
  };
}

/**
 * Real user authenticated via session/token (human users).
 * Has access rules and roles from the RBAC system.
 */
export interface RealUser {
  type: "user";
  id: string;
  email?: string;
  name?: string;
  accessRules?: string[];
  roles?: string[];
  teamIds?: string[];
  [key: string]: unknown;
}

/**
 * Service user for backend-to-backend calls.
 * Trusted implicitly - no accesss/roles needed.
 */
export interface ServiceUser {
  type: "service";
  pluginId: string;
}

/**
 * External application authenticated via API key.
 * Has access rules and roles from the RBAC system like RealUser.
 */
export interface ApplicationUser {
  type: "application";
  id: string;
  name: string;
  accessRules?: string[];
  roles?: string[];
  teamIds?: string[];
}

/**
 * Discriminated union of user types.
 * Use `user.type` to discriminate between real users, services, and applications.
 */
export type AuthUser = RealUser | ServiceUser | ApplicationUser;

export interface AuthService {
  authenticate(request: Request): Promise<AuthUser | undefined>;
  getCredentials(): Promise<{ headers: Record<string, string> }>;
  /**
   * Get access rules assigned to the anonymous role.
   * Used by autoAuthMiddleware to check accesss for unauthenticated
   * users on "public" userType endpoints.
   */
  getAnonymousAccessRules(): Promise<string[]>;
  /**
   * Check if a user has access to a specific resource via team grants.
   */
  check(params: {
    userId: string;
    userType: "user" | "application";
    objectType: string;
    objectId: string;
    action: "read" | "manage";
    hasGlobalAccess: boolean;
  }): Promise<{ hasAccess: boolean }>;
  /**
   * Filter a list of object ids of one type to those the caller can access.
   * Used for bulk filtering of list/record endpoints.
   */
  listAccessibleObjectIds(params: {
    userId: string;
    userType: "user" | "application";
    objectType: string;
    objectIds: string[];
    action: "read" | "manage";
    hasGlobalAccess: boolean;
  }): Promise<string[]>;
  /**
   * Whether the caller holds ANY team grant of the given level on a concrete
   * object of this TYPE, independent of a specific id. Lets the list/record
   * post-filter tell a categorically-unauthorized caller (no global access AND
   * no grant for the type) from one legitimately scoped to an empty subset.
   */
  hasAnyTypeGrant(params: {
    userId: string;
    userType: "user" | "application";
    objectType: string;
    action: "read" | "manage";
    /**
     * Also count a type-level `creator` (create-capability) grant. Used by the
     * `typeScoped` instanceAccess gate so a team member who may CREATE the type
     * is authorized for its authoring utilities before owning any instance.
     */
    includeCreator?: boolean;
  }): Promise<{ hasGrant: boolean }>;
  /**
   * Decide whether a caller may CREATE an object of `objectType` and which team
   * (if any) should own it. Resolves the create-authorization matrix (global
   * manage, `creator` grants, single vs multi eligible team). Throws FORBIDDEN /
   * BAD_REQUEST (with a `data.code`) when creation is not allowed or an owning
   * team must be chosen.
   */
  authorizeCreate(params: {
    userId: string;
    userType: "user" | "application";
    objectType: string;
    requestedTeamId?: string;
    hasGlobalManage: boolean;
    /** Already authorized by another gate (e.g. parent manage); only resolve the owner. */
    alreadyAuthorized?: boolean;
  }): Promise<{ ownerTeamId: string | null; isPrivate: boolean }>;
  /**
   * Record ownership of a freshly-created object: the team gets the `owner`
   * relation and, unless `isPrivate`, the `public` viewer marker (team-managed,
   * globally readable by default). Called by create handlers after the row is
   * persisted.
   */
  setOwner(params: {
    objectType: string;
    objectId: string;
    teamId: string;
    isPrivate?: boolean;
  }): Promise<void>;
}

/**
 * Authentication strategy for validating user credentials.
 * Returns RealUser for human users or ApplicationUser for API keys.
 */
export interface AuthenticationStrategy {
  validate(request: Request): Promise<RealUser | ApplicationUser | undefined>;
}

// Runtime-plugin installer types live in ./plugin-source.ts and are
// re-exported via the package index.

/**
 * Options for declarative route definitions (Deprecated, will be replaced by oRPC procedures).
 */
export interface RouteOptions {
  accessRule?: string | string[];
  schema?: ZodSchema;
}

/**
 * RPC Client for typed backend-to-backend communication.
 * Similar to the frontend RpcApi but with service token authentication.
 */
export interface RpcClient {
  /**
   * Get a typed RPC client for a specific plugin.
   * @param def - The client definition from the target plugin's common package
   * @returns Typed client for the plugin's RPC endpoints
   *
   * @example
   * import { AuthApi } from "@checkstack/auth-common";
   * const authClient = rpcClient.forPlugin(AuthApi);
   * const result = await authClient.getRegistrationStatus();
   */
  forPlugin<T extends ClientDefinition>(def: T): InferClient<T>;
}
