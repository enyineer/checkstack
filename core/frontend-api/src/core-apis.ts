import { AccessRule, ClientDefinition, InferClient } from "@checkstack/common";
import { createApiRef } from "./api-ref";

export interface LoggerApi {
  info(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

export interface FetchApi {
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
  forPlugin(pluginId: string): {
    fetch(path: string, init?: RequestInit): Promise<Response>;
  };
}

export const loggerApiRef = createApiRef<LoggerApi>("core.logger");
export const fetchApiRef = createApiRef<FetchApi>("core.fetch");

/**
 * Unified access API for checking user access via AccessRules.
 *
 * Uses the same AccessRule objects from plugin common packages
 * that are used in backend contracts.
 */
export interface AccessApi {
  /**
   * Check if the current user has access based on an AccessRule.
   *
   * @example
   * ```tsx
   * import { catalogAccess } from "@checkstack/catalog-common";
   *
   * const { allowed, loading } = accessApi.useAccess(catalogAccess.system.manage);
   * if (allowed) {
   *   // User can manage systems
   * }
   * ```
   */
  useAccess(accessRule: AccessRule): { loading: boolean; allowed: boolean };
  /**
   * Whether the current user is authenticated (logged in). Use to gate UI that
   * needs a real user but no specific access rule - e.g. per-user actions like
   * muting your own anomaly notifications, which any logged-in user may do but
   * an anonymous visitor may not.
   *
   * @example
   * ```tsx
   * const { isAuthenticated } = accessApi.useIsAuthenticated();
   * if (isAuthenticated) {
   *   // show the per-user action
   * }
   * ```
   */
  useIsAuthenticated(): { loading: boolean; isAuthenticated: boolean };
}

export const accessApiRef = createApiRef<AccessApi>("core.access");

export interface RpcApi {
  client: unknown;
  forPlugin<T extends ClientDefinition>(def: T): InferClient<T>;
}

export const rpcApiRef = createApiRef<RpcApi>("core.rpc");
