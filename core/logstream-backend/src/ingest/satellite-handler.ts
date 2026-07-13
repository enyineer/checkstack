/**
 * Logstream contribution to the satellite telemetry channel (capability kind
 * "logstream"). A satellite forwards logs a shipper handed it over the WS
 * channel instead of the HTTP endpoints; this handler reproduces the endpoints'
 * trust boundary on the CORE side, where the token DB and the stream config
 * live:
 *
 * 1. verify each item's `streamToken` with the EXISTING ingest authenticator
 *    (revocation intact - it reads the shared token cache), resolving the
 *    `streamId`; a bad/revoked token drops that item's lines as `rejected`;
 * 2. re-clamp every line's timestamp against the CORE clock (the satellite's
 *    clock is untrusted) and re-apply the stream's `severityRules.valueMap`
 *    (which the agent could not, having no per-stream config);
 * 3. feed the resolved lines into the SAME ingest pipeline the HTTP endpoints
 *    use (one shared buffer/flush - never a second path).
 *
 * The ack mirrors HTTP semantics: a token rejection is terminal (the agent
 * drops + counts the loss); a whole-batch saturation that wrote NOTHING is
 * retryable (like a 429), which is safe precisely because nothing was buffered,
 * so the agent's resend cannot double-write. Any partial accept is terminal, so
 * a resend never duplicates the accepted lines (the pipeline is not idempotent).
 *
 * STATE & SCALE: this handler holds no state; it verifies against the shared
 * token cache and writes through the pod-local pipeline buffer, exactly as the
 * HTTP endpoints do. A read of the durable log data is identical on every pod.
 */

import type { Logger, SafeDatabase } from "@checkstack/backend-api";
import type { SatelliteCapabilityHandler } from "@checkstack/satellite-backend";
import {
  SatelliteLogBatchSchema,
  applySeverityValueMap,
  clampEventTimestamp,
  type IngestedLine,
  type LogStreamConfig,
  type SatelliteLogLine,
} from "@checkstack/logstream-common";
import * as schema from "../schema";
import { addInTransitDrops } from "../storage/activity";
import type { AuthResult, IngestAuthenticator } from "./auth";
import type { StreamConfigResolver } from "./stream-config";
import type { IngestPipeline } from "./pipeline";

/** The capability kind this handler owns (matches the agent-side receiver tag). */
export const LOGSTREAM_CAPABILITY_KIND = "logstream";

/** Rehydrate one wire line into a stored {@link IngestedLine} under the core's trust. */
function toIngestedLine({
  wire,
  config,
  observedAt,
}: {
  wire: SatelliteLogLine;
  config: LogStreamConfig;
  observedAt: Date;
}): IngestedLine {
  // The satellite's clock is untrusted: re-clamp `ts` into the trust window
  // around the core's receive time, not the agent's.
  const { ts } = clampEventTimestamp({ ts: new Date(wire.ts), observedAt });
  // The agent normalized with the built-in banding (no per-stream config); apply
  // the stream's value map now, keyed on the retained raw severity text.
  const band = applySeverityValueMap({
    band: wire.band,
    rawValue: wire.severityText,
    valueMap: config.severityRules?.valueMap,
  });
  return {
    ts,
    observedAt,
    severityNumber: wire.severityNumber,
    ...(wire.severityText === undefined
      ? {}
      : { severityText: wire.severityText }),
    band,
    body: wire.body,
    ...(wire.attributes === undefined ? {} : { attributes: wire.attributes }),
    ...(wire.resource === undefined ? {} : { resource: wire.resource }),
    ...(wire.traceId === undefined ? {} : { traceId: wire.traceId }),
    ...(wire.spanId === undefined ? {} : { spanId: wire.spanId }),
  };
}

export function createLogstreamSatelliteCapabilityHandler({
  db,
  auth,
  configResolver,
  pipeline,
  logger,
  now = () => new Date(),
}: {
  db: SafeDatabase<typeof schema>;
  auth: IngestAuthenticator;
  configResolver: StreamConfigResolver;
  pipeline: IngestPipeline;
  logger: Logger;
  now?: () => Date;
}): SatelliteCapabilityHandler {
  /**
   * Record one stream's satellite in-transit drops (best-effort: a bookkeeping
   * write must never fail an accepted batch).
   */
  async function recordInTransitDrop(
    streamId: string,
    dropped: number,
  ): Promise<void> {
    try {
      await addInTransitDrops({ runner: db, streamId, dropped });
    } catch (error) {
      logger.warn(
        `logstream: failed to record in-transit drops for stream ${streamId}: ${String(error)}`,
      );
    }
  }

  return {
    kind: LOGSTREAM_CAPABILITY_KIND,
    async handleTelemetryBatch({ satelliteId, payload, droppedByGroup }) {
      const parsed = SatelliteLogBatchSchema.safeParse(payload);
      if (!parsed.success) {
        // A malformed payload can never become valid on resend -> terminal.
        logger.warn(
          `logstream: malformed satellite log batch from ${satelliteId}; dropping`,
        );
        return { accepted: 0, rejected: 0, retryable: false };
      }

      let accepted = 0;
      let rejected = 0;
      let sawAccept = false;
      let sawSaturation = false;

      // Verify each distinct token once, then group resolved lines per stream so
      // a stream is fed in one `ingest` call (matches the endpoints' per-request
      // shape and the pipeline's per-stream flush).
      const verdicts = new Map<string, AuthResult>();
      const byStream = new Map<
        string,
        { tokenId: string; config: LogStreamConfig; lines: IngestedLine[] }
      >();

      for (const item of parsed.data) {
        let verdict = verdicts.get(item.streamToken);
        if (!verdict) {
          verdict = await auth.verify(item.streamToken);
          verdicts.set(item.streamToken, verdict);
        }
        if (!verdict.ok) {
          // Unknown/revoked token: drop these lines (terminal). Mirrors the
          // HTTP endpoint's 401 - the shipper's token is simply not valid.
          rejected += item.lines.length;
          continue;
        }

        let entry = byStream.get(verdict.streamId);
        if (!entry) {
          const config = await configResolver.resolve(verdict.streamId);
          entry = { tokenId: verdict.tokenId, config, lines: [] };
          byStream.set(verdict.streamId, entry);
        }
        const observedAt = now();
        for (const wire of item.lines) {
          entry.lines.push(
            toIngestedLine({ wire, config: entry.config, observedAt }),
          );
        }
      }

      for (const [streamId, entry] of byStream) {
        const result = pipeline.ingest({
          streamId,
          lines: entry.lines,
          config: entry.config,
          tokenId: entry.tokenId,
          now: now(),
        });
        accepted += result.accepted;
        const dropped = result.rejectedRateLimit + result.rejectedBuffer;
        rejected += dropped;
        if (result.accepted > 0) sawAccept = true;
        if (dropped > 0) sawSaturation = true;
      }

      // Record telemetry the satellite dropped from its own buffer, attributing
      // each group's loss to the EXACT stream that lost it. The group key is the
      // stream token, resolved through the SAME verdict cache the payload used
      // (a drop-only token need not appear in this batch's items). An
      // unknown/revoked token has no stream to charge, so its loss is left
      // unattributed rather than smeared across other streams. Best-effort.
      for (const [streamToken, dropped] of Object.entries(droppedByGroup ?? {})) {
        if (dropped <= 0) continue;
        let verdict = verdicts.get(streamToken);
        if (!verdict) {
          verdict = await auth.verify(streamToken);
          verdicts.set(streamToken, verdict);
        }
        if (!verdict.ok) {
          logger.debug(
            `logstream: satellite ${satelliteId} reported ${dropped} in-transit ` +
              `drop(s) for an unresolvable stream token; not attributing`,
          );
          continue;
        }
        await recordInTransitDrop(verdict.streamId, dropped);
      }

      // Nothing written AND the only failure was saturation -> ask the agent to
      // retry later (transient, like a 429). Because nothing was buffered, the
      // resent batch cannot duplicate. Any partial accept is terminal.
      const retryable = !sawAccept && sawSaturation;
      return { accepted, rejected, retryable };
    },
  };
}
