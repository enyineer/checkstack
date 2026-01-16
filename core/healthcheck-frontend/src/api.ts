// Re-export types for convenience
export type {
  HealthCheckConfiguration,
  HealthCheckStrategyDto,
  HealthCheckRun,
  HealthCheckRunPublic,
} from "@checkstack/healthcheck-common";
// Client definition is in @checkstack/healthcheck-common - use with usePluginClient
export { HealthCheckApi } from "@checkstack/healthcheck-common";
