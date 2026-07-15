/**
 * The PUSH telemetry source type for log streams.
 *
 * A "push" source has the OWNING PLUGIN serve an inbound endpoint (OTLP/HTTP,
 * the native NDJSON route) and shippers authenticate with a per-instance bearer
 * token the PLATFORM mints. Creating an instance mints the `ckls_` token (only
 * its sha256 hash is stored, shown once, rotatable); the endpoint owner verifies
 * presented tokens through the platform's push-token verifier service. So this
 * module does no token STORAGE at all - it only declares the seam (the token
 * prefix + the inbound endpoints the UI renders setup snippets for). The verify
 * path is wired in `../setup.ts` via `createPushTokenLookup`.
 *
 * This is the migration target for logstream's former `log_stream_tokens` table:
 * telemetry migration 0002 promoted every non-revoked token to a
 * `logstream.push` source instance, keyed on the SAME token id and hash, so the
 * existing shipper tokens keep working across the cutover unchanged.
 */

import { z } from "zod";
import { TOKEN_PREFIX, pluginMetadata } from "@checkstack/logstream-common";
import { defineTelemetrySourceType } from "@checkstack/telemetry-backend";

/**
 * The push source type's LOCAL id. Qualified with the plugin id it becomes
 * {@link LOGSTREAM_PUSH_SOURCE_TYPE_ID} - which MUST match the literal telemetry
 * migration 0002 promoted rows under (`logstream.push`).
 */
export const PUSH_SOURCE_TYPE_LOCAL_ID = "push";

/**
 * The qualified push source-type id. This is the `sourceTypeId` the verify path
 * scopes push-token lookups to (`createPushTokenLookup`) and the value the
 * platform stamps on promoted rows in telemetry migration 0002 - the two MUST
 * agree or promoted tokens read as unknown.
 */
export const LOGSTREAM_PUSH_SOURCE_TYPE_ID = `${pluginMetadata.pluginId}.${PUSH_SOURCE_TYPE_LOCAL_ID}`;

/** Push instances carry no config: the bearer token + binding are everything. */
export const PushSourceConfigSchema = z.object({});
export type PushSourceConfig = z.infer<typeof PushSourceConfigSchema>;

/**
 * The push source type. Registered against `telemetrySourceExtensionPoint` in
 * the plugin's `register()` (see the wiring in `index.ts`).
 */
export const pushSourceType = defineTelemetrySourceType<PushSourceConfig>({
  id: PUSH_SOURCE_TYPE_LOCAL_ID,
  displayName: "Push (OTLP / native)",
  description:
    "Ship logs to Checkstack over HTTP. Each source mints a bearer token; " +
    "shippers send it as `Authorization: Bearer <token>` to the OTLP/HTTP or " +
    "native ingest endpoint, and every line authenticated by that token is " +
    "routed to the bound log stream.",
  icon: "Upload",
  signals: ["logs"],
  configSchema: PushSourceConfigSchema,
  push: {
    tokenPrefix: TOKEN_PREFIX,
    endpoints: [
      { kind: "otlp", path: "/api/logstream/v1/logs", label: "OTLP logs" },
      { kind: "native", path: "/api/logstream/ingest", label: "Native JSON" },
    ],
  },
});
