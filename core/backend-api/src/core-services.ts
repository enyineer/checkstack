import { createServiceRef } from "./service-ref";
import type { RpcService } from "./rpc";
import type { HealthCheckRegistry } from "./health-check";
import type {
  QueuePluginRegistry,
  QueueManager,
} from "@checkmate-monitor/queue-api";
import type { ConfigService } from "./config-service";
import type { SignalService } from "@checkmate-monitor/signal-common";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  Logger,
  Fetch,
  AuthService,
  PluginInstaller,
  RpcClient,
} from "./types";
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
  rpcClient: createServiceRef<RpcClient>("core.rpcClient"),
  queuePluginRegistry: createServiceRef<QueuePluginRegistry>(
    "core.queuePluginRegistry"
  ),
  queueManager: createServiceRef<QueueManager>("core.queueManager"),
  config: createServiceRef<ConfigService>("core.config"),
  eventBus: createServiceRef<EventBus>("core.eventBus"),
  signalService: createServiceRef<SignalService>("core.signalService"),
};
