/**
 * Thin Bun.serve wrapper hosting the agent's telemetry HTTP receivers on ONE
 * port. Routes are supplied by the composition root (log routes always; metric
 * routes when the metricstream receiver is wired), keeping this module ignorant
 * of any specific capability. Unknown paths get 404, so an operator sees a clear
 * answer when they post to the wrong path.
 */

import { z } from "zod";

/** Default receiver port (the OTLP/HTTP convention). */
export const DEFAULT_RECEIVER_PORT = 4318;

interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug: (msg: string) => void;
}

export const ReceiverEnvConfigSchema = z.object({
  port: z.coerce.number().int().min(1).max(65_535).default(DEFAULT_RECEIVER_PORT),
  hostname: z.string().default("0.0.0.0"),
});
export type ReceiverEnvConfig = z.infer<typeof ReceiverEnvConfigSchema>;

/** Read the receiver HTTP config from the environment (host + port). */
export function readReceiverEnvConfig(
  env: NodeJS.ProcessEnv = process.env,
): ReceiverEnvConfig {
  return ReceiverEnvConfigSchema.parse({
    port: env.CHECKSTACK_SATELLITE_RECEIVER_PORT,
    hostname: env.CHECKSTACK_SATELLITE_RECEIVER_HOST,
  });
}

export type ReceiverRoute = (request: Request) => Promise<Response>;

export interface TelemetryHttpServer {
  readonly port: number;
  stop(): void;
}

/**
 * Start the receiver HTTP server. `routes` maps an exact pathname (e.g.
 * `/v1/logs`) to its handler. Returns a handle whose `port` reflects the bound
 * port (useful when `port: 0` selects a free port in tests).
 */
export function startTelemetryHttpServer({
  config,
  routes,
  logger,
}: {
  config: ReceiverEnvConfig;
  routes: Record<string, ReceiverRoute>;
  logger: Logger;
}): TelemetryHttpServer {
  const server = Bun.serve({
    hostname: config.hostname,
    port: config.port,
    fetch: async (request) => {
      const { pathname } = new URL(request.url);
      const route = routes[pathname];
      if (!route) {
        return Response.json({ error: "not found" }, { status: 404 });
      }
      try {
        return await route(request);
      } catch (error) {
        logger.error(`satellite: receiver route ${pathname} threw: ${String(error)}`);
        return Response.json({ error: "internal error" }, { status: 500 });
      }
    },
  });

  logger.info(
    `satellite: telemetry HTTP receiver on ${config.hostname}:${server.port} ` +
      `(${Object.keys(routes).join(", ")})`,
  );

  return {
    port: server.port ?? config.port,
    stop() {
      void server.stop(true);
    },
  };
}
