/**
 * OTLP/JSON metrics parsing now lives in `@checkstack/metricstream-common` so the
 * satellite agent's `/v1/metrics` receiver can import the SAME pure parser. This
 * module re-exports it for the backend ingest path (endpoint.ts) - no behaviour
 * change, import-path only.
 */
export { parseOtlpMetricsJson } from "@checkstack/metricstream-common";
