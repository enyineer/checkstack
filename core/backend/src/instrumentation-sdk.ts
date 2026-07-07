import { metrics } from "@opentelemetry/api";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { adminPool, lockPool } from "./db";
import { rootLogger } from "./logger";

/**
 * OpenTelemetry metrics bootstrap (host-owned).
 *
 * OFF by default. Enable with `CHECKSTACK_METRICS_ENABLED=1`, which registers a
 * global `MeterProvider` + a Prometheus exporter and starts the host-owned
 * observable instruments (DB pool state, event-loop delay). Once the provider
 * is registered, the lazy instruments in `@checkstack/backend-api`'s
 * `instrumentation` module (db transactions/queries, health-check phases, queue
 * counters) bind to the real meter on first use; while disabled they are OTel
 * no-ops, so the whole layer is free.
 *
 * The exporter runs its OWN HTTP server (default `127.0.0.1:9464/metrics`), NOT
 * a route on the main app, so it is not exposed to the internet and carries no
 * app auth surface. To scrape from another host, set
 * `CHECKSTACK_METRICS_HOST=0.0.0.0` deliberately and firewall accordingly.
 */

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const METER_NAME = "@checkstack/platform";

let provider: MeterProvider | undefined;
let lagTimer: ReturnType<typeof setInterval> | undefined;

/**
 * Start metrics export if enabled. Idempotent and safe to call before plugins
 * initialize (so migration/startup queries are already counted). No-op unless
 * `CHECKSTACK_METRICS_ENABLED` is set.
 */
export function startMetrics(): void {
  if (!process.env.CHECKSTACK_METRICS_ENABLED) return;
  if (provider) return;

  const host = process.env.CHECKSTACK_METRICS_HOST ?? "127.0.0.1";
  const port = intFromEnv("CHECKSTACK_METRICS_PORT", 9464);

  const exporter = new PrometheusExporter({ host, port, endpoint: "/metrics" }, () => {
    rootLogger.info(
      `Metrics: Prometheus exporter listening on http://${host}:${port}/metrics`,
    );
  });

  provider = new MeterProvider({
    resource: resourceFromAttributes({ "service.name": "checkstack" }),
    readers: [exporter],
  });
  metrics.setGlobalMeterProvider(provider);

  registerHostInstruments();
}

/** Stop the exporter + lag sampler and flush. Call on graceful shutdown. */
export async function stopMetrics(): Promise<void> {
  if (lagTimer) {
    clearInterval(lagTimer);
    lagTimer = undefined;
  }
  if (provider) {
    await provider.shutdown();
    provider = undefined;
  }
}

function registerHostInstruments(): void {
  const meter = metrics.getMeter(METER_NAME);

  // ── DB pool state (observable: read on scrape) ──
  const pool = meter.createObservableGauge("checkstack.db.pool.connections", {
    description: "DB pool connections by pool and state.",
    unit: "{connection}",
  });
  pool.addCallback((result) => {
    for (const [name, p] of [
      ["admin", adminPool],
      ["lock", lockPool],
    ] as const) {
      result.observe(p.totalCount - p.idleCount, { pool: name, state: "active" });
      result.observe(p.idleCount, { pool: name, state: "idle" });
      // `waiting` > 0 means callers are BLOCKED on connection checkout — the
      // real signal of pool exhaustion (vs the pool merely being populated).
      result.observe(p.waitingCount, { pool: name, state: "waiting" });
    }
  });

  // ── Event-loop delay (self-correcting setInterval drift) ──
  // A histogram of how far each tick overran its schedule = how long the single
  // JS thread was blocked. p95/max here is the direct test for CPU starvation.
  const lag = meter.createHistogram("checkstack.runtime.event_loop_delay", {
    description: "Event-loop delay sampled from setInterval drift.",
    unit: "ms",
  });
  const INTERVAL_MS = 100;
  let last = performance.now();
  lagTimer = setInterval(() => {
    const now = performance.now();
    lag.record(Math.max(0, now - last - INTERVAL_MS));
    last = now;
  }, INTERVAL_MS);
  // Never keep the process alive just for sampling.
  lagTimer.unref?.();
}
