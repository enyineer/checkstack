/**
 * @checkstack/ingest-utils - source-agnostic ingest primitives shared by ingest
 * plugins (logstream, metricstream, ...). BACKEND-ONLY: several modules import
 * node builtins (`node:crypto`, `node:zlib`), so this package must never be
 * imported by a browser bundle. A plugin's browser-safe token FORMAT half stays
 * in its own `*-common` package.
 *
 * The pure protobuf wire codec and signal-agnostic OTLP readers moved to the
 * browser-safe foundation leaf `@checkstack/otlp-wire`; they are re-exported
 * here unchanged so existing backend consumers keep compiling.
 */

export * from "./token/source-token-kit";
export * from "./auth/ingest-authenticator";
export * from "./http/body";
export * from "./rate-limit/rate-limit";
export * from "./buffer/ingest-buffer";
export * from "./flush/flush-loop";
export * from "@checkstack/otlp-wire";
