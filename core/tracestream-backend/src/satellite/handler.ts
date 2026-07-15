/**
 * Tracestream contribution to the satellite telemetry channel (capability kind
 * "tracestream"). A satellite forwards spans a shipper handed it over the WS
 * channel instead of the HTTP endpoints; this handler reproduces the endpoints'
 * trust boundary on the CORE side, where the token DB and the stream config live:
 *
 * 1. verify each item's `streamToken` with the EXISTING ingest authenticator
 *    (revocation intact - it reads the shared token cache), resolving the
 *    `streamId`; a bad/revoked token drops that item's spans as `rejected`;
 * 2. rehydrate each wire span with `fromWireSpan` and feed it into the SAME
 *    ingest pipeline the HTTP endpoints use, passing the CORE clock as `now`.
 *    The pipeline's `prepareSpan` re-clamps every span's timestamps against that
 *    clock (the satellite's clock is untrusted) exactly as it does for the OTLP /
 *    native push endpoints - so the forwarded path never bypasses the clamp, and
 *    we never clamp twice.
 *
 * The ack mirrors HTTP semantics: a token rejection is terminal (the agent drops
 * + counts the loss); a whole-batch saturation that wrote NOTHING is retryable
 * (like a 429), safe because nothing was buffered so a resend cannot double-write.
 * Any partial accept is terminal, so a resend never duplicates accepted spans (the
 * pipeline is not idempotent at the buffer level).
 *
 * STATE & SCALE: this handler holds no state; it verifies against the shared token
 * cache and writes through the pod-local pipeline buffer, exactly as the HTTP
 * endpoints do. A read of the durable trace data is identical on every pod.
 *
 * DROP ACCOUNTING GAP: tracestream has no per-stream "dropped in transit" counter
 * (unlike logstream/metricstream's `addInTransitDrops`); its `ActivityStore.touch`
 * advances the received timestamp + rate and is not a plain increment. So a
 * satellite's `droppedByGroup` is resolved to its stream and persisted durably via
 * `activity.addInTransitDrops` (upsert-increment on the stream's activity row's
 * `dropped_in_transit_count`, mirroring logstream). An unresolvable token has no
 * stream to charge, so its loss is only logged.
 */

import type { Logger } from "@checkstack/backend-api";
import type {
  IngestAuthResult,
  IngestAuthenticator,
} from "@checkstack/ingest-utils";
import type { SatelliteCapabilityHandler } from "@checkstack/satellite-backend";
import {
  SatelliteTraceBatchSchema,
  fromWireSpan,
  type TraceStreamConfig,
} from "@checkstack/tracestream-common";
import type { NormalizedSpan } from "@checkstack/telemetry-common";
import type { IngestPipeline } from "../ingest/pipeline";
import type { StreamConfigResolver } from "../ingest/stream-config";
import type { ActivityStore } from "../storage/ports";

/** The capability kind this handler owns (matches the agent-side receiver tag). */
export const TRACESTREAM_CAPABILITY_KIND = "tracestream";

export function createTracestreamSatelliteCapabilityHandler({
  auth,
  configResolver,
  pipeline,
  activity,
  recordSeen,
  logger,
  now = () => new Date(),
}: {
  /** cktr_ push-token authenticator (the same one the push endpoints use). */
  auth: IngestAuthenticator;
  configResolver: StreamConfigResolver;
  pipeline: IngestPipeline;
  /** Activity store, for the durable per-stream in-transit drop counter. */
  activity: Pick<ActivityStore, "addInTransitDrops">;
  /**
   * Fire-and-forget last-seen stamp for each verified push source (`tokenId`)
   * that forwarded spans through this satellite batch. Same throttled verifier
   * stamp the HTTP endpoints use.
   */
  recordSeen?: (tokenId: string) => void;
  logger: Logger;
  now?: () => Date;
}): SatelliteCapabilityHandler {
  /**
   * Record one stream's satellite in-transit drops (best-effort: a bookkeeping
   * write must never fail an accepted batch, so its failure is caught + logged).
   */
  async function recordInTransitDrop(
    streamId: string,
    dropped: number,
  ): Promise<void> {
    try {
      await activity.addInTransitDrops({ streamId, dropped });
      logger.debug(
        `tracestream: recorded ${dropped} in-transit drop(s) for stream ${streamId}`,
      );
    } catch (error) {
      logger.warn(
        `tracestream: failed to record in-transit drops for stream ${streamId}: ${String(error)}`,
      );
    }
  }

  return {
    kind: TRACESTREAM_CAPABILITY_KIND,
    async handleTelemetryBatch({ satelliteId, payload, droppedByGroup }) {
      const parsed = SatelliteTraceBatchSchema.safeParse(payload);
      if (!parsed.success) {
        // A malformed payload can never become valid on resend -> terminal.
        logger.warn(
          `tracestream: malformed satellite trace batch from ${satelliteId}; dropping`,
        );
        return { accepted: 0, rejected: 0, retryable: false };
      }

      let accepted = 0;
      let rejected = 0;
      let sawAccept = false;
      let sawSaturation = false;

      // Verify each distinct token once, then group resolved spans per stream so
      // a stream is fed in one `ingest` call (matches the endpoints' per-request
      // shape and the pipeline's per-stream flush).
      const verdicts = new Map<string, IngestAuthResult>();
      const verify = async (token: string): Promise<IngestAuthResult> => {
        let verdict = verdicts.get(token);
        if (!verdict) {
          verdict = await auth.verify(token);
          verdicts.set(token, verdict);
        }
        return verdict;
      };

      const byStream = new Map<
        string,
        { config: TraceStreamConfig; spans: NormalizedSpan[] }
      >();

      // Distinct verified source instance ids that forwarded spans, stamped
      // last-seen once each after the batch (throttled inside the verifier).
      const seenTokenIds = new Set<string>();

      for (const item of parsed.data) {
        if (item.spans.length === 0) continue;
        const verdict = await verify(item.streamToken);
        if (!verdict.ok) {
          // Unknown/revoked token: drop these spans (terminal). Mirrors the HTTP
          // endpoint's 401 - the shipper's token is simply not valid.
          rejected += item.spans.length;
          continue;
        }

        seenTokenIds.add(verdict.tokenId);
        let entry = byStream.get(verdict.resourceId);
        if (!entry) {
          const config = await configResolver.resolve(verdict.resourceId);
          entry = { config, spans: [] };
          byStream.set(verdict.resourceId, entry);
        }
        for (const wire of item.spans) entry.spans.push(fromWireSpan(wire));
      }

      const at = now();
      for (const [streamId, entry] of byStream) {
        const result = pipeline.ingest({
          streamId,
          spans: entry.spans,
          config: entry.config,
          // The core clock: `prepareSpan` re-clamps each span's untrusted times
          // against this observedAt before buffering (parity with the endpoints).
          now: at,
        });
        accepted += result.accepted;
        const dropped = result.rejectedRateLimit + result.rejectedBuffer;
        rejected += dropped;
        if (result.accepted > 0) sawAccept = true;
        if (dropped > 0) sawSaturation = true;
      }

      // Stamp last-seen for each verified source that forwarded spans (the
      // verifier throttles per source, so a stamp per batch is cheap).
      for (const tokenId of seenTokenIds) recordSeen?.(tokenId);

      // Satellite in-transit drops: resolve each group's token to its stream via
      // the SAME verdict cache the payload used, then PERSIST the loss on that
      // stream's activity row (`addInTransitDrops`, upsert-increment). An
      // unknown/revoked token has no stream to charge, so its loss is only logged.
      //
      // BEST-EFFORT (must never flip the ack): this runs AFTER spans were ingested
      // and calls `verify`, which can THROW on a transient token-cache hiccup (a
      // Redis blip). An uncaught throw would propagate out of handleTelemetryBatch,
      // the WS layer would ack {retryable: true}, and the agent would resend a batch
      // whose spans were already accepted - double-charging activity counters, the
      // rate limiter and buffer budgets and violating the "partial accept is
      // terminal" invariant. So we swallow any failure here and only log it (the
      // per-stream write is itself caught in `recordInTransitDrop`); the ack has
      // already been decided by the ingest outcome above.
      try {
        for (const [streamToken, dropped] of Object.entries(droppedByGroup ?? {})) {
          if (dropped <= 0) continue;
          const verdict = await verify(streamToken);
          if (!verdict.ok) {
            logger.debug(
              `tracestream: satellite ${satelliteId} reported ${dropped} in-transit ` +
                `drop(s) for an unresolvable stream token; not attributing`,
            );
            continue;
          }
          await recordInTransitDrop(verdict.resourceId, dropped);
        }
      } catch (error) {
        logger.warn(
          `tracestream: in-transit drop attribution failed for satellite ` +
            `${satelliteId} (does not affect the accepted batch): ${String(error)}`,
        );
      }

      // Nothing written AND the only failure was saturation -> ask the agent to
      // retry later (transient, like a 429). Because nothing was buffered, the
      // resent batch cannot duplicate. Any partial accept is terminal.
      const retryable = !sawAccept && sawSaturation;
      return { accepted, rejected, retryable };
    },
  };
}
