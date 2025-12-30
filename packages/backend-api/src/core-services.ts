import { createServiceRef } from "./service-ref";
import type { RpcService } from "./rpc";
import type { HealthCheckRegistry } from "./health-check";
import type { QueuePluginRegistry, QueueFactory } from "@checkmate/queue-api";
import type { ConfigService } from "./config-service";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Logger, Fetch, AuthService, PluginInstaller } from "./types";
import type { EventBus } from "./event-bus-types";

export * from "./types";

export const authenticationStrategyServiceRef = createServiceRef<unknown>(
  "internal.authenticationStrategy"
);

export const coreServices = {
  database:
    createServiceRef<NodePgDatabase<Record<string, unknown>>>("core.database"),
  logger: createServiceRef<Logger>("core.logger"),
  fetch: createServiceRef<Fetch>("core.fetch"),
  auth: createServiceRef<AuthService>("core.auth"),
  healthCheckRegistry: createServiceRef<HealthCheckRegistry>(
    "core.healthCheckRegistry"
  ),
  pluginInstaller: createServiceRef<PluginInstaller>("core.pluginInstaller"),
  rpc: createServiceRef<RpcService>("core.rpc"),
  queuePluginRegistry: createServiceRef<QueuePluginRegistry>(
    "core.queuePluginRegistry"
  ),
  queueFactory: createServiceRef<QueueFactory>("core.queueFactory"),
  config: createServiceRef<ConfigService>("core.config"),
  eventBus: createServiceRef<EventBus>("core.eventBus"),
};
