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
  hasPermission(permission: string): boolean;
}

export const permissionApiRef = createApiRef<PermissionApi>("core.permission");
