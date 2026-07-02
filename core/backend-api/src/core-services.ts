import { createServiceRef } from "./service-ref";
import type { RpcService } from "./rpc";
import type { HealthCheckRegistry } from "./health-check";
import type { CollectorRegistry } from "./collector-registry";
import type { QueuePluginRegistry, QueueManager } from "@checkstack/queue-api";
import type {
  CachePluginRegistry,
  CacheManager,
} from "@checkstack/cache-api";
import type { ConfigService } from "./config-service";
import type { SignalService } from "@checkstack/signal-common";
import { SafeDatabase } from "./plugin-system";
import { Logger, Fetch, AuthService, RpcClient } from "./types";
import type { PluginInstallerRegistry } from "./plugin-source";
import type { PluginArtifactStore } from "./plugin-artifact-store";
import type { EventBus } from "./event-bus-types";
import type { WebSocketRouteRegistry } from "./ws-registry";
import type { ReadinessRegistry } from "./readiness-registry";
import type { AdvisoryLockService } from "./advisory-lock";
import type { ResourceResolverRegistry } from "./resource-resolver";
import type { InstanceRuntime } from "./instance-runtime";

export * from "./types";
export * from "./resource-resolver";

export const authenticationStrategyServiceRef = createServiceRef<unknown>(
  "internal.authenticationStrategy",
);

export const coreServices = {
  database:
    createServiceRef<SafeDatabase<Record<string, unknown>>>("core.database"),
  logger: createServiceRef<Logger>("core.logger"),
  fetch: createServiceRef<Fetch>("core.fetch"),
  auth: createServiceRef<AuthService>("core.auth"),
  healthCheckRegistry: createServiceRef<HealthCheckRegistry>(
    "core.healthCheckRegistry",
  ),
  collectorRegistry: createServiceRef<CollectorRegistry>(
    "core.collectorRegistry",
  ),
  /**
   * Cross-plugin resource name/search registry. Owning plugins register a
   * resolver for their team-scopable resource types at init; the auth backend
   * reads it to render team grants by name and to power the grant picker.
   */
  resourceResolverRegistry: createServiceRef<ResourceResolverRegistry>(
    "core.resourceResolverRegistry",
  ),
  /**
   * Per-source installer registry used by the runtime plugin system.
   * Indexed by `PluginSource["type"]` (npm, tarball, github, catalog).
   */
  pluginInstallerRegistry: createServiceRef<PluginInstallerRegistry>(
    "core.pluginInstallerRegistry",
  ),
  /**
   * Persistent tarball store backing fresh-instance bootstrap and
   * cross-instance artifact sharing.
   */
  pluginArtifactStore: createServiceRef<PluginArtifactStore>(
    "core.pluginArtifactStore",
  ),
  rpc: createServiceRef<RpcService>("core.rpc"),
  rpcClient: createServiceRef<RpcClient>("core.rpcClient"),
  /**
   * Factory for an RPC client that authenticates as a specific APPLICATION
   * (service account), not as the trusted service. The returned client mints a
   * short-lived, backend-signed app-principal token; the live router resolves
   * it to an `application` principal subject to the FULL access-rule and
   * team-scope enforcement (never the service short-circuit). Used by the
   * automation dispatch engine to run an automation as its configured `runAs`.
   *
   * Trusted infra: callable only by backend plugin code. The authority to bind
   * a given application is gated separately when the automation is saved.
   */
  rpcClientAs: createServiceRef<(applicationId: string) => Promise<RpcClient>>(
    "core.rpcClientAs",
  ),
  queuePluginRegistry: createServiceRef<QueuePluginRegistry>(
    "core.queuePluginRegistry",
  ),
  queueManager: createServiceRef<QueueManager>("core.queueManager"),
  config: createServiceRef<ConfigService>("core.config"),
  eventBus: createServiceRef<EventBus>("core.eventBus"),
  signalService: createServiceRef<SignalService>("core.signalService"),
  wsRegistry: createServiceRef<WebSocketRouteRegistry>("core.wsRegistry"),
  cachePluginRegistry: createServiceRef<CachePluginRegistry>(
    "core.cachePluginRegistry",
  ),
  cacheManager: createServiceRef<CacheManager>("core.cacheManager"),
  readinessRegistry: createServiceRef<ReadinessRegistry>(
    "core.readinessRegistry",
  ),
  /**
   * Postgres advisory-lock service backed by a dedicated pooled client, so
   * session-level locks keep connection affinity across acquire/release.
   * See {@link AdvisoryLockService}.
   */
  advisoryLock: createServiceRef<AdvisoryLockService>("core.advisoryLock"),
  /**
   * Identifies which INSTANCE this backend runs as, so plugins can namespace
   * any state they keep on shared external infrastructure (redis/BullMQ keys,
   * shared cache prefixes, consumer groups). The default instance carries the
   * empty namespace; a secondary instance (e.g. the PR-preview instance)
   * carries a non-empty slug. See {@link InstanceRuntime}.
   */
  instanceRuntime: createServiceRef<InstanceRuntime>("core.instanceRuntime"),
};
