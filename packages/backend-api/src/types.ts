import { ZodSchema } from "zod";

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

export type AuthUser = {
  [key: string]: unknown;
  permissions?: string[];
  roles?: string[];
};

export interface AuthService {
  authenticate(request: Request): Promise<AuthUser | undefined>;
  getCredentials(): Promise<{ headers: Record<string, string> }>;
}

export interface AuthenticationStrategy {
  validate(request: Request): Promise<AuthUser | undefined>;
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
   * @param pluginId - The ID of the target plugin
   * @returns Typed client for the plugin's RPC endpoints
   *
   * @example
   * const authClient = rpcClient.forPlugin<AuthClient>("auth-backend");
   * const result = await authClient.getRegistrationStatus();
   */
  forPlugin<T>(pluginId: string): T;
}
