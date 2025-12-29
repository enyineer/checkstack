import { PermissionAction } from "@checkmate/common";
import { createApiRef } from "./api-ref";

export interface LoggerApi {
  info(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

export interface FetchApi {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  forPlugin(pluginId: string): {
    fetch(path: string, init?: RequestInit): Promise<Response>;
  };
}

export const loggerApiRef = createApiRef<LoggerApi>("core.logger");
export const fetchApiRef = createApiRef<FetchApi>("core.fetch");

export interface PermissionApi {
  usePermission(permission: string): { loading: boolean; allowed: boolean };
  useResourcePermission(
    resource: string,
    action: PermissionAction
  ): { loading: boolean; allowed: boolean };
  useManagePermission(resource: string): { loading: boolean; allowed: boolean };
}

export const permissionApiRef = createApiRef<PermissionApi>("core.permission");

export interface RpcApi {
  client: unknown;
  forPlugin<T>(pluginId: string): T;
}

export const rpcApiRef = createApiRef<RpcApi>("core.rpc");
