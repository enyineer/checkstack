/**
 * Tracestream's PUSH telemetry source type (`tracestream.push`).
 *
 * PUSH is the platform seam for "a shipper authenticates with a per-instance
 * bearer token the PLATFORM mints, and the OWNING PLUGIN serves the inbound
 * endpoint". Tracestream owns the OTLP (`/api/tracestream/v1/traces`) and native
 * (`/api/tracestream/ingest`) span-push routes; the platform owns the token
 * lifecycle (mint on create, rotate, revoke on disable/delete) and the
 * `telemetry_sources.push_token_hash` storage. Creating a `tracestream.push`
 * instance mints a `cktr_` token bound to a traces stream; the ingest handlers
 * verify presented tokens through the platform's push-token verifier (see
 * `ingest/token-lookup.ts`), so this type carries NO seam logic beyond the
 * `push` descriptor the UI renders setup snippets from.
 *
 * This REPLACES tracestream's old per-stream token CRUD (the dropped
 * `trace_stream_tokens` table): migration `telemetry 0002` promoted every
 * non-revoked legacy token to a `tracestream.push` instance with the hash reused
 * verbatim, so existing shippers keep authenticating without a re-mint.
 */

import { z } from "zod";
import { defineTelemetrySourceType } from "@checkstack/telemetry-backend";
import { TRACESTREAM_TOKEN_PREFIX } from "@checkstack/tracestream-common";

/**
 * Local type id, qualified by the platform to `tracestream.push`. MUST match the
 * literal migration `telemetry 0002` promoted legacy tokens under, or promoted
 * instances would read as a different (unknown) source type.
 */
export const TRACESTREAM_PUSH_LOCAL_ID = "push";

/** Qualified source type id: `${pluginId}.${TRACESTREAM_PUSH_LOCAL_ID}`. */
export const TRACESTREAM_PUSH_SOURCE_TYPE_ID = "tracestream.push";

/**
 * A push instance carries no config: the per-instance bearer token (minted +
 * stored by the platform) and the traces-stream binding are its entire state.
 */
export const TracestreamPushConfigSchema = z.object({});
export type TracestreamPushConfig = z.infer<typeof TracestreamPushConfigSchema>;

export const tracestreamPushSourceType =
  defineTelemetrySourceType<TracestreamPushConfig>({
    id: TRACESTREAM_PUSH_LOCAL_ID,
    displayName: "Push (OTLP / native)",
    description:
      "Ship spans directly to a trace stream over OTLP/HTTP or the native " +
      "JSON endpoint, authenticated with a per-instance bearer token.",
    icon: "Waypoints",
    signals: ["traces"],
    configSchema: TracestreamPushConfigSchema,
    push: {
      tokenPrefix: TRACESTREAM_TOKEN_PREFIX,
      endpoints: [
        {
          kind: "otlp",
          path: "/api/tracestream/v1/traces",
          label: "OTLP traces",
        },
        {
          kind: "native",
          path: "/api/tracestream/ingest",
          label: "Native JSON",
        },
      ],
    },
  });
