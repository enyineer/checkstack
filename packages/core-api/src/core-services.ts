import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { createServiceRef } from "./service-ref";

// Define a Logger interface to avoid strict dependency on specific logger lib in types
export interface Logger {
  info(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
}

// Define Fetch interface
export interface Fetch {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

// Define AuthenticationStrategy interface (for verifying User Sessions)
export interface AuthenticationStrategy {
  validate(request: Request): Promise<any | null>; // Returns User or null
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
};
