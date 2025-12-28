import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Hono, MiddlewareHandler, Env } from "hono";
import { createServiceRef } from "./service-ref";

// Define a Logger interface to avoid strict dependency on specific logger lib in types
export interface Logger {
  info(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

import { z, ZodSchema } from "zod";

// Permission Check Middleware Factory
export type PermissionCheck = (permission: string) => MiddlewareHandler;

// Validation Middleware Factory
export type ValidationCheck = <T extends ZodSchema>(
  schema: T
) => MiddlewareHandler<
  Env,
  string,
  { in: { json: z.infer<T> }; out: { json: z.infer<T> } }
>;

// Define Fetch interface
export interface Fetch {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export type AuthUser = {
  [key: string]: unknown;
  permissions?: string[];
  roles?: string[];
};

// Define AuthenticationStrategy interface (for verifying User Sessions)
export interface AuthenticationStrategy {
  validate(request: Request): Promise<AuthUser | undefined>; // Returns User or undefined
}

export interface PluginInstaller {
  install(packageName: string): Promise<{ name: string; path: string }>;
}

export interface TokenVerification {
  /**
   * Verified a token and returns the payload.
   * Returns undefined if invalid.
   */
  verify(token: string): Promise<Record<string, unknown> | undefined>;
  /**
   * Signs a payload for service-to-service communication.
   */
  sign(payload: Record<string, unknown>): Promise<string>;
}

export const coreServices = {
  database:
    createServiceRef<NodePgDatabase<Record<string, never>>>("core.database"),
  httpRouter: createServiceRef<Hono>("core.httpRouter"),
  logger: createServiceRef<Logger>("core.logger"),
  fetch: createServiceRef<Fetch>("core.fetch"),
  authentication: createServiceRef<AuthenticationStrategy>(
    "core.authentication"
  ),
  permissionCheck: createServiceRef<PermissionCheck>("core.permissionCheck"),
  validation: createServiceRef<ValidationCheck>("core.validation"),
  healthCheckRegistry: createServiceRef<
    import("./health-check").HealthCheckRegistry
  >("core.healthCheckRegistry"),
  pluginInstaller: createServiceRef<PluginInstaller>("core.pluginInstaller"),
  tokenVerification: createServiceRef<TokenVerification>(
    "core.tokenVerification"
  ),
  queuePluginRegistry: createServiceRef<
    import("@checkmate/queue-api").QueuePluginRegistry
  >("core.queuePluginRegistry"),
  queueFactory:
    createServiceRef<import("@checkmate/queue-api").QueueFactory>(
      "core.queueFactory"
    ),
};
