import { ZodSchema } from "zod";
import { ClientDefinition, InferClient } from "@checkmate-monitor/common";

export interface Logger {
  info(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
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
 * Has permissions and roles from the RBAC system.
 */
export interface RealUser {
  type: "user";
  id: string;
  email?: string;
  name?: string;
  permissions?: string[];
  roles?: string[];
  [key: string]: unknown;
}

/**
 * Service user for backend-to-backend calls.
 * Trusted implicitly - no permissions/roles needed.
 */
export interface ServiceUser {
  type: "service";
  pluginId: string;
}

/**
 * External application authenticated via API key.
 * Has permissions and roles from the RBAC system like RealUser.
 */
export interface ApplicationUser {
  type: "application";
  id: string;
  name: string;
  permissions?: string[];
  roles?: string[];
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
   * Get permissions assigned to the anonymous role.
   * Used by autoAuthMiddleware to check permissions for unauthenticated
   * users on "public" userType endpoints.
   */
  getAnonymousPermissions(): Promise<string[]>;
}

/**
 * Authentication strategy for validating user credentials.
 * Returns RealUser for human users or ApplicationUser for API keys.
 */
export interface AuthenticationStrategy {
  validate(request: Request): Promise<RealUser | ApplicationUser | undefined>;
}

export interface PluginInstaller {
  install(packageName: string): Promise<{ name: string; path: string }>;
}

/**
 * Options for declarative route definitions (Deprecated, will be replaced by oRPC procedures).
 */
export interface RouteOptions {
  permission?: string | string[];
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
   * import { AuthApi } from "@checkmate-monitor/auth-common";
   * const authClient = rpcClient.forPlugin(AuthApi);
   * const result = await authClient.getRegistrationStatus();
   */
  forPlugin<T extends ClientDefinition>(def: T): InferClient<T>;
}
