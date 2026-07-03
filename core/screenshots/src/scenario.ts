/**
 * The demo world. A small but believable SaaS stack - a payments company -
 * whose shape lights up every surface: grouped systems across prod/staging, a
 * multi-hop dependency graph centered on the checkout path, a spread of
 * health-check strategies, SLOs, and a live incident.
 *
 * This module is pure data. `seed/entities.ts` interprets it into API calls and
 * `seed/history.ts` reads the `healthProfile` to synthesize matching history.
 */

/** How a check's synthesized history should look, driving runs/aggregates/SLO. */
export type HealthProfile =
  | "solid" // ~100% healthy, low flat latency
  | "fast" // healthy, very low latency (cache/dns)
  | "degraded" // mostly healthy with periodic degraded spikes
  | "recent-outage" // healthy history + one sharp recent unhealthy dip
  | "flapping"; // intermittent failures, noisier latency

export interface CheckSpec {
  /** Stable key so history can find the created configuration id. */
  key: string;
  name: string;
  /**
   * The REGISTERED, namespaced strategy id (e.g. `healthcheck-http.http`), not
   * the bare protocol name. The editor, run executor, and run-detail charts all
   * look a check's strategy up by this exact id, so a bare `"http"` reads back
   * as an uninstalled strategy even though the plugin is loaded.
   */
  strategyId: string;
  /** Strategy-level config (Record). For http this is just `{ timeout }`. */
  config: Record<string, unknown>;
  /** Optional collectors (http request lives here, not in `config`). */
  collectors?: {
    collectorId: string;
    config: Record<string, unknown>;
    assertions?: {
      field: string;
      operator: string;
      jsonPath?: string;
      value?: unknown;
    }[];
  }[];
  intervalSeconds: number;
  healthProfile: HealthProfile;
  /** Baseline latency (ms) the history generator centers on. */
  baseLatencyMs: number;
}

export interface SystemSpec {
  key: string;
  name: string;
  description: string;
  group: string;
  environments: string[];
  metadata: Record<string, unknown>;
  checks: CheckSpec[];
  /** Create an SLO objective bound to the first check of this system. */
  slo?: { target: number; windowDays: number };
}

export const GROUPS = ["Payments", "Storefront", "Platform"] as const;

export const ENVIRONMENTS = [
  { name: "production", description: "Live customer traffic", region: "eu-west-1" },
  { name: "staging", description: "Pre-production", region: "eu-west-1" },
] as const;

const httpCollector = (url: string, status = 200) => ({
  collectorId: "healthcheck-http.request",
  config: { url, method: "GET", timeout: 30_000 },
  assertions: [{ field: "statusCode", operator: "eq", value: status }],
});

export const SYSTEMS: SystemSpec[] = [
  {
    key: "checkout-api",
    name: "checkout-api",
    description: "Public checkout and cart API - the revenue path.",
    group: "Payments",
    environments: ["production", "staging"],
    metadata: { tier: "1", language: "TypeScript", oncall: "payments" },
    slo: { target: 99.9, windowDays: 30 },
    checks: [
      {
        key: "checkout-http",
        name: "Checkout API health",
        strategyId: "healthcheck-http.http",
        config: { timeout: 30_000 },
        collectors: [httpCollector("https://checkout.acme.dev/healthz")],
        intervalSeconds: 60,
        healthProfile: "recent-outage",
        baseLatencyMs: 140,
      },
      {
        key: "checkout-tls",
        name: "Checkout TLS certificate",
        strategyId: "healthcheck-tls.tls",
        config: { timeout: 30_000, host: "checkout.acme.dev", port: 443 },
        intervalSeconds: 3600,
        healthProfile: "solid",
        baseLatencyMs: 90,
      },
    ],
  },
  {
    key: "payments-service",
    name: "payments-service",
    description: "Charges cards and reconciles ledgers.",
    group: "Payments",
    environments: ["production", "staging"],
    metadata: { tier: "1", language: "Go", oncall: "payments" },
    slo: { target: 99.95, windowDays: 30 },
    checks: [
      {
        key: "payments-grpc",
        name: "Payments gRPC",
        strategyId: "healthcheck-grpc.grpc",
        config: { timeout: 30_000, host: "payments.internal", port: 50_051 },
        intervalSeconds: 60,
        healthProfile: "degraded",
        baseLatencyMs: 55,
      },
    ],
  },
  {
    key: "postgres-primary",
    name: "postgres-primary",
    description: "Primary transactional database.",
    group: "Platform",
    environments: ["production"],
    metadata: { tier: "1", engine: "PostgreSQL 16" },
    checks: [
      {
        key: "pg-check",
        name: "Postgres primary",
        strategyId: "healthcheck-postgres.postgres",
        config: {
          timeout: 30_000,
          host: "db.internal",
          port: 5432,
          database: "payments",
          user: "monitor",
        },
        intervalSeconds: 30,
        healthProfile: "solid",
        baseLatencyMs: 12,
      },
    ],
  },
  {
    key: "redis-cache",
    name: "redis-cache",
    description: "Session and rate-limit cache.",
    group: "Platform",
    environments: ["production"],
    metadata: { tier: "2", engine: "Redis 7" },
    checks: [
      {
        key: "redis-check",
        name: "Redis cache",
        strategyId: "healthcheck-redis.redis",
        config: { timeout: 30_000, host: "cache.internal", port: 6379 },
        intervalSeconds: 30,
        healthProfile: "fast",
        baseLatencyMs: 4,
      },
    ],
  },
  {
    key: "web-storefront",
    name: "web-storefront",
    description: "Customer-facing storefront SPA and BFF.",
    group: "Storefront",
    environments: ["production", "staging"],
    metadata: { tier: "1", language: "TypeScript" },
    slo: { target: 99.5, windowDays: 30 },
    checks: [
      {
        key: "storefront-http",
        name: "Storefront homepage",
        strategyId: "healthcheck-http.http",
        config: { timeout: 30_000 },
        collectors: [httpCollector("https://acme.dev/")],
        intervalSeconds: 120,
        healthProfile: "flapping",
        baseLatencyMs: 220,
      },
    ],
  },
  {
    key: "search-service",
    name: "search-service",
    description: "Product search and autocomplete.",
    group: "Storefront",
    environments: ["production"],
    metadata: { tier: "2", language: "Rust" },
    checks: [
      {
        key: "search-http",
        name: "Search API",
        strategyId: "healthcheck-http.http",
        config: { timeout: 30_000 },
        collectors: [httpCollector("https://search.acme.dev/health")],
        intervalSeconds: 120,
        healthProfile: "degraded",
        baseLatencyMs: 180,
      },
    ],
  },
  {
    key: "auth-service",
    name: "auth-service",
    description: "Authentication and session issuance.",
    group: "Platform",
    environments: ["production"],
    metadata: { tier: "1", language: "TypeScript" },
    checks: [
      {
        key: "auth-tcp",
        name: "Auth service TCP",
        strategyId: "healthcheck-tcp.tcp",
        config: { timeout: 30_000, host: "auth.internal", port: 8443 },
        intervalSeconds: 60,
        healthProfile: "solid",
        baseLatencyMs: 20,
      },
    ],
  },
  {
    key: "cdn-edge",
    name: "cdn-edge",
    description: "Edge cache and static asset delivery.",
    group: "Platform",
    environments: ["production"],
    metadata: { tier: "2", provider: "Fastly" },
    checks: [
      {
        key: "cdn-dns",
        name: "CDN DNS",
        strategyId: "healthcheck-dns.dns",
        config: { timeout: 30_000, hostname: "cdn.acme.dev", recordType: "A" },
        intervalSeconds: 300,
        healthProfile: "fast",
        baseLatencyMs: 8,
      },
    ],
  },
  {
    key: "notifications-worker",
    name: "notifications-worker",
    description: "Async email and push delivery worker.",
    group: "Platform",
    environments: ["production"],
    metadata: { tier: "3", language: "TypeScript" },
    checks: [
      {
        key: "notif-ssh",
        name: "Worker host",
        strategyId: "healthcheck-ping.ping",
        config: { timeout: 30_000, host: "worker-01.internal" },
        intervalSeconds: 120,
        healthProfile: "solid",
        baseLatencyMs: 30,
      },
    ],
  },
];

/**
 * Hand-tuned left-to-right layered layout for the dependency-map screenshot,
 * keyed by system key. The default on-load layout is a naive grid that ignores
 * edges, so we seed these positions (via `saveNodePositions`) to get a clean
 * DAG: top consumers on the left (web-storefront, notifications-worker), the
 * checkout path through the middle, and the shared data stores on the right
 * (postgres-primary). Columns are ~340px apart, rows ~170px, matching the app's
 * own node scale.
 */
export const NODE_POSITIONS: Record<string, { x: number; y: number }> = {
  "web-storefront": { x: 100, y: 215 },
  "notifications-worker": { x: 100, y: 470 },
  "checkout-api": { x: 440, y: 130 },
  "search-service": { x: 440, y: 300 },
  "cdn-edge": { x: 440, y: 470 },
  "payments-service": { x: 780, y: 130 },
  "auth-service": { x: 780, y: 300 },
  "redis-cache": { x: 780, y: 470 },
  "postgres-primary": { x: 1120, y: 300 },
};

/** Directional edges: source (downstream) depends on target (upstream). */
export const DEPENDENCIES: {
  source: string;
  target: string;
  impactType: "informational" | "degraded" | "critical";
  label: string;
}[] = [
  { source: "web-storefront", target: "checkout-api", impactType: "critical", label: "checkout" },
  { source: "web-storefront", target: "search-service", impactType: "degraded", label: "search" },
  { source: "web-storefront", target: "cdn-edge", impactType: "degraded", label: "assets" },
  { source: "checkout-api", target: "payments-service", impactType: "critical", label: "charges" },
  { source: "checkout-api", target: "redis-cache", impactType: "degraded", label: "sessions" },
  { source: "checkout-api", target: "auth-service", impactType: "critical", label: "auth" },
  { source: "payments-service", target: "postgres-primary", impactType: "critical", label: "ledger" },
  { source: "auth-service", target: "postgres-primary", impactType: "critical", label: "users" },
  { source: "search-service", target: "postgres-primary", impactType: "informational", label: "index" },
  { source: "notifications-worker", target: "redis-cache", impactType: "degraded", label: "queue" },
];
