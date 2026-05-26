import { ZodSchema } from "zod";
import { ClientDefinition, InferClient } from "@checkstack/common";

/**
 * Backend logger interface used everywhere in the platform via `RpcContext.logger`
 * and the various `coreServices.logger` accessors.
 *
 * Each method accepts a free-form trailing argument list (`...args: unknown[]`)
 * so the long-standing varargs callsites — `logger.error("…", err)` where `err`
 * is an `Error`, or `logger.info("…", value1, value2)` — keep working unchanged.
 *
 * For NEW code, prefer the structured-metadata shape:
 *
 *   logger.info("did something", { userId, durationMs });
 *
 * Winston's `splat` handling treats a single trailing plain object as
 * structured metadata (merged into the log entry), and an `Error` instance as
 * a special-cased error (with stack). Either shape lands in the same vararg
 * slot here, so this signature covers both without overload churn.
 *
 * Auto-injected metadata (when the request flows through
 * `correlationMiddleware`): `{ correlationId, pluginId, userId? }`. Do NOT
 * include secrets in the structured-metadata object — it is forwarded
 * verbatim to the log destination.
 */
export interface Logger {
  info(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  /**
   * Returns a derived logger with the supplied metadata bound to every
   * subsequent log entry. Used by `correlationMiddleware` to attach
   * `{ correlationId, pluginId, userId? }`, and available to handlers that
   * want a tighter scope (e.g. `ctx.logger.child({ jobId })`).
   *
   * Optional only to keep minimal test-mock logger objects compatible with
   * this interface — production loggers (Winston via `core/backend`) always
   * implement it. Call sites that rely on metadata binding should branch
   * on presence and fall back to the base logger when it is not available.
   */
  child?(meta: Record<string, unknown>): Logger;
}

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
  checkResourceTeamAccess(params: {
    userId: string;
    userType: "user" | "application";
    resourceType: string;
    resourceId: string;
    action: "read" | "manage";
    hasGlobalAccess: boolean;
  }): Promise<{ hasAccess: boolean }>;
  /**
   * Get IDs of resources the user can access from a given list.
   * Used for bulk filtering of list endpoints.
   */
  getAccessibleResourceIds(params: {
    userId: string;
    userType: "user" | "application";
    resourceType: string;
    resourceIds: string[];
    action: "read" | "manage";
    hasGlobalAccess: boolean;
  }): Promise<string[]>;
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
