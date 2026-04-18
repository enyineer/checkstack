import { z } from "zod";

// =============================================================================
// STRATEGY CATEGORIES
// =============================================================================

/**
 * Predefined categories for health check strategies.
 * Strategy plugins select from this enum at registration time.
 */
export const StrategyCategory = {
  /** HTTP, DNS, TCP, Ping, UDP, SNMP, TLS */
  NETWORKING: "networking",
  /** Postgres, MySQL, Redis, MongoDB, ClickHouse */
  DATABASE: "database",
  /** SSH, Script, Hardware (CPU/Mem/Disk) */
  INFRASTRUCTURE: "infrastructure",
  /** Docker, Kubernetes, container health */
  CONTAINERIZATION: "containerization",
  /** S3, MinIO, NFS, backup verification */
  STORAGE: "storage",
  /** gRPC, GraphQL, WebSocket, SOAP */
  APPLICATION: "application",
  /** RabbitMQ, Kafka, MQTT, NATS, AMQP */
  MESSAGING: "messaging",
  /** SMTP, IMAP, POP3, deliverability */
  EMAIL: "email",
  /** AWS, Azure, GCP managed services */
  CLOUD: "cloud",
  /** Jenkins, GitLab, Jira, third-party APIs */
  INTEGRATION: "integration",
  /** LLM endpoints, model inference, GPU, API quotas */
  AI: "ai",
  /** TLS certificates, auth endpoints, OCSP, compliance */
  SECURITY: "security",
  /** MQTT devices, sensors, edge gateways */
  IOT: "iot",
  /** RCON, Source Query, game server protocols */
  GAMING: "gaming",
  /** Prometheus, metrics pipelines, log health */
  OBSERVABILITY: "observability",
  /** Catch-all for uncategorized strategies */
  OTHER: "other",
} as const;

export type StrategyCategory =
  (typeof StrategyCategory)[keyof typeof StrategyCategory];

/**
 * Zod schema for validating strategy categories.
 */
export const StrategyCategorySchema = z.enum([
  StrategyCategory.NETWORKING,
  StrategyCategory.DATABASE,
  StrategyCategory.INFRASTRUCTURE,
  StrategyCategory.CONTAINERIZATION,
  StrategyCategory.STORAGE,
  StrategyCategory.APPLICATION,
  StrategyCategory.MESSAGING,
  StrategyCategory.EMAIL,
  StrategyCategory.CLOUD,
  StrategyCategory.INTEGRATION,
  StrategyCategory.AI,
  StrategyCategory.SECURITY,
  StrategyCategory.IOT,
  StrategyCategory.GAMING,
  StrategyCategory.OBSERVABILITY,
  StrategyCategory.OTHER,
]);

// =============================================================================
// CATEGORY DISPLAY METADATA
// =============================================================================

interface CategoryMeta {
  /** Human-readable label for UI rendering */
  label: string;
  /** Sort order for UI grouping (lower = first) */
  sortOrder: number;
}

/**
 * Display metadata for each strategy category.
 * Used by the Strategy Picker page for grouping and ordering.
 */
export const STRATEGY_CATEGORY_META: Record<StrategyCategory, CategoryMeta> = {
  [StrategyCategory.NETWORKING]: { label: "Networking", sortOrder: 0 },
  [StrategyCategory.DATABASE]: { label: "Databases", sortOrder: 1 },
  [StrategyCategory.INFRASTRUCTURE]: { label: "Infrastructure", sortOrder: 2 },
  [StrategyCategory.CONTAINERIZATION]: {
    label: "Containerization",
    sortOrder: 3,
  },
  [StrategyCategory.STORAGE]: { label: "Storage", sortOrder: 4 },
  [StrategyCategory.APPLICATION]: { label: "Application", sortOrder: 5 },
  [StrategyCategory.MESSAGING]: { label: "Messaging", sortOrder: 6 },
  [StrategyCategory.EMAIL]: { label: "Email", sortOrder: 7 },
  [StrategyCategory.CLOUD]: { label: "Cloud", sortOrder: 8 },
  [StrategyCategory.INTEGRATION]: { label: "Integrations", sortOrder: 9 },
  [StrategyCategory.AI]: { label: "AI & Machine Learning", sortOrder: 10 },
  [StrategyCategory.SECURITY]: { label: "Security", sortOrder: 11 },
  [StrategyCategory.IOT]: { label: "IoT", sortOrder: 12 },
  [StrategyCategory.GAMING]: { label: "Gaming", sortOrder: 13 },
  [StrategyCategory.OBSERVABILITY]: { label: "Observability", sortOrder: 14 },
  [StrategyCategory.OTHER]: { label: "Other", sortOrder: 99 },
};
