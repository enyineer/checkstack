/**
 * Composition of the agent's telemetry RECEIVERS + PULL scheduler behind their
 * capability flags. Given the (already-instantiated) telemetry client and agent
 * capability registry, this starts:
 *
 * - the HTTP receiver (`/v1/logs`, `/ingest`, `/v1/metrics`, `/ingest/metrics`)
 *   on ONE port when the "log-receivers" capability is advertised (it hosts both
 *   the log and metric HTTP receivers, per the telemetry plan);
 * - the TCP/TLS syslog listener when "syslog" is advertised;
 * - the telemetry-pull scheduler (a capability CONSUMER of pushed source
 *   instances) when "telemetry-pull" is advertised.
 *
 * Everything forwards into the ONE telemetry client, which owns bounded
 * buffering + the credit window. Returns a handle the composition root stops on
 * shutdown.
 */

import type { TelemetryEnqueuer } from "./enqueuer";
import type { AgentCapabilityRegistry } from "../capability-config-registry";
import { createLogReceiverHandlers } from "./log-receiver";
import { createMetricReceiverHandlers } from "./metric-receiver";
import { createTraceReceiverHandlers } from "./trace-receiver";
import {
  readReceiverEnvConfig,
  startTelemetryHttpServer,
  type ReceiverRoute,
  type TelemetryHttpServer,
} from "./http-server";
import {
  createSatelliteSyslogListener,
  readSatelliteSyslogEnvConfig,
  type SyslogListener,
} from "./syslog-listener";
import {
  TelemetryPullScheduler,
  TELEMETRY_PULL_CAPABILITY_KIND,
  type FetchSecretFn,
} from "./pull/scheduler";

interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug: (msg: string) => void;
}

export interface TelemetryReceivers {
  /** Stop every started receiver / pull scheduler (idempotent). */
  stop(): void;
}

export function startTelemetryReceivers({
  capabilities,
  telemetryClient,
  capabilityRegistry,
  fetchSecret,
  logger,
  env = process.env,
}: {
  capabilities: string[];
  telemetryClient: TelemetryEnqueuer;
  capabilityRegistry: AgentCapabilityRegistry;
  /** JIT capability-secret fetch (bound to the satellite client). */
  fetchSecret: FetchSecretFn;
  logger: Logger;
  env?: NodeJS.ProcessEnv;
}): TelemetryReceivers {
  let httpServer: TelemetryHttpServer | null = null;
  let syslog: SyslogListener | null = null;
  let pullScheduler: TelemetryPullScheduler | null = null;

  // Log/metric AND trace receivers share ONE HTTP server/port; each capability
  // contributes its own routes and the server starts when EITHER is advertised.
  const routes: Record<string, ReceiverRoute> = {};
  if (capabilities.includes("log-receivers")) {
    const logs = createLogReceiverHandlers({ enqueue: telemetryClient, logger });
    const metrics = createMetricReceiverHandlers({
      enqueue: telemetryClient,
      logger,
    });
    routes["/v1/logs"] = logs.otlpLogs;
    routes["/ingest"] = logs.nativeLogs;
    routes["/v1/metrics"] = metrics.otlpMetrics;
    routes["/ingest/metrics"] = metrics.nativeMetrics;
  }
  if (capabilities.includes("trace-receivers")) {
    const traces = createTraceReceiverHandlers({
      enqueue: telemetryClient,
      logger,
    });
    routes["/v1/traces"] = traces.otlpTraces;
    routes["/ingest/traces"] = traces.nativeTraces;
  }
  if (Object.keys(routes).length > 0) {
    httpServer = startTelemetryHttpServer({
      config: readReceiverEnvConfig(env),
      routes,
      logger,
    });
  }

  if (capabilities.includes("syslog")) {
    const syslogConfig = readSatelliteSyslogEnvConfig(env);
    if (syslogConfig) {
      syslog = createSatelliteSyslogListener({
        config: syslogConfig,
        enqueue: telemetryClient,
        logger,
      });
      syslog.start();
    } else {
      logger.warn(
        "satellite: syslog capability advertised but CHECKSTACK_SATELLITE_SYSLOG_PORT is unset; listener not started",
      );
    }
  }

  if (capabilities.includes("telemetry-pull")) {
    pullScheduler = new TelemetryPullScheduler({
      enqueue: telemetryClient,
      emitStatus: (input) => capabilityRegistry.emitStatus(input),
      fetchSecret,
      logger,
    });
    const scheduler = pullScheduler;
    capabilityRegistry.register({
      kind: TELEMETRY_PULL_CAPABILITY_KIND,
      onCapabilityConfig: ({ payload }) => scheduler.applyConfig(payload),
    });
  }

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      httpServer?.stop();
      syslog?.stop();
      pullScheduler?.stop();
    },
  };
}
