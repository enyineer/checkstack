/**
 * The "push" telemetry SOURCE TYPE - metricstream's contribution to the telemetry
 * platform's PUSH source mode. A push instance has no poller: the OWNING PLUGIN
 * (metricstream) serves the inbound OTLP + native ingest endpoints and shippers
 * authenticate with a per-instance bearer token the PLATFORM mints (hash-only
 * storage, shown once, rotatable). The endpoints verify presented tokens through
 * the platform's push-token verifier (`createPushTokenLookup` +
 * `IngestAuthenticator`), so token lifecycle (mint / rotate / disable / delete)
 * is entirely the platform's - the plugin owns no token table anymore.
 *
 * The qualified id `metricstream.push` MUST match the telemetry migration literal
 * that promoted the legacy `metric_stream_tokens` rows into `metricstream.push`
 * source instances (id/hash reuse), and the `tokenPrefix` MUST stay `ckms_` so
 * existing shipper tokens keep authenticating across the migration.
 */

import { z } from "zod";
import {
  defineTelemetrySourceType,
  type TelemetrySourceTypeDefinition,
} from "@checkstack/telemetry-backend";
import { METRICSTREAM_TOKEN_PREFIX } from "@checkstack/metricstream-common";

/** Local id; the platform qualifies it as `${pluginId}.${id}`. */
export const METRICSTREAM_PUSH_LOCAL_ID = "push";

/** Qualified push source type id (`metricstream.push`). MUST match the telemetry
 * migration literal and the ingest-auth lookup's `sourceTypeId`. */
export const METRICSTREAM_PUSH_QUALIFIED_ID = "metricstream.push";

/**
 * Build the "push" source type definition. A push type has no `pull`/`webhook`/
 * `listener`/`derive` seam - the `push` seam declares the token prefix and the
 * inbound endpoints the platform UI renders setup snippets for. `configSchema` is
 * empty: a push instance carries no user config beyond its bindings + minted
 * token.
 */
export function createMetricstreamPushSourceType(): TelemetrySourceTypeDefinition<
  Record<string, never>
> {
  return defineTelemetrySourceType({
    id: METRICSTREAM_PUSH_LOCAL_ID,
    displayName: "Push (OTLP / native)",
    description:
      "Ship metrics to Checkstack over HTTP: OTLP/HTTP (`/api/metricstream/v1/metrics`) " +
      "or native JSON (`/api/metricstream/ingest`), authenticating with this " +
      "instance's bearer token. No poller - your shipper pushes on its own cadence.",
    icon: "Upload",
    signals: ["metrics"],
    configSchema: z.object({}),
    push: {
      tokenPrefix: METRICSTREAM_TOKEN_PREFIX,
      endpoints: [
        {
          kind: "otlp",
          path: "/api/metricstream/v1/metrics",
          label: "OTLP metrics",
        },
        {
          kind: "native",
          path: "/api/metricstream/ingest",
          label: "Native JSON",
        },
      ],
    },
  });
}
