/**
 * @checkstack/otlp-wire - the dependency-free protobuf wire codec and the
 * signal-agnostic OTLP structure readers shared by every OTLP export decoder
 * (logs, metrics, ...). FOUNDATION LEAF: zero runtime dependencies and, by
 * design, ZERO node builtins - so it is safe to import from a `*-common`
 * package that ships to the browser (a guard test enforces this). Backend-only
 * ingest helpers stay in `@checkstack/ingest-utils`, which re-exports this
 * module for backward compatibility.
 */

export * from "./wire";
export * from "./otlp";
