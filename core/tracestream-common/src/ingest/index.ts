/**
 * Browser-safe trace ingest parsing: OTLP (protobuf + JSON) and native JSON span
 * decoders, plus the span-timestamp clamp. Shared by the backend ingest pipeline
 * AND (Phase 3) the satellite trace receiver, so both normalize spans identically
 * before they reach storage.
 */

export * from "./clamp";
export * from "./otlp";
export * from "./native";
