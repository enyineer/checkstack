/**
 * The "metricstream" satellite capability handler: a satellite receiver accepted
 * push telemetry for one or more streams and FORWARDS it over the channel.
 * Authorized end to end by each stream's `ckms_` source token - core verifies it
 * exactly like the HTTP push endpoint (revocation intact), so a satellite
 * forwarding a batch has no more authority than a direct shipper holding the same
 * token.
 *
 * The payload is an ARRAY of per-token groups (a receiver may forward several
 * streams' telemetry in one batch). A token rejection (unknown / revoked) is
 * TERMINAL, not transient: that group is dropped (its datapoints counted as
 * rejected) so the agent counts the loss instead of resending forever. A
 * successfully-authorized group goes through the SAME {@link MetricIngestSink}
 * the HTTP push + scrape paths use.
 */

import type { Logger, SafeDatabase } from "@checkstack/backend-api";
import type { IngestAuthenticator } from "@checkstack/ingest-utils";
import {
  MetricstreamForwardBatchSchema,
  METRICSTREAM_TELEMETRY_KIND,
  wireDatapointToNormalized,
} from "@checkstack/metricstream-common";
import type { SatelliteCapabilityHandler } from "@checkstack/satellite-backend";
import * as schema from "../schema";
import type { MetricIngestSink } from "../sources/extension-point";
import { addInTransitDrops } from "../storage/activity";

type Db = SafeDatabase<typeof schema>;

export function createMetricstreamForwardHandler({
  db,
  sink,
  auth,
  logger,
  now = () => new Date(),
}: {
  db: Db;
  sink: MetricIngestSink;
  /** ckms_ source-token authenticator (the same one the push endpoints use). */
  auth: IngestAuthenticator;
  logger: Logger;
  now?: () => Date;
}): SatelliteCapabilityHandler {
  async function handleTelemetryBatch({
    satelliteId,
    payload,
    droppedByGroup,
  }: {
    satelliteId: string;
    payload: unknown;
    droppedByGroup?: Record<string, number>;
  }): Promise<{ accepted: number; rejected: number; retryable?: boolean }> {
    const parsed = MetricstreamForwardBatchSchema.safeParse(payload);
    if (!parsed.success) {
      logger.warn(
        `metricstream: dropping malformed forwarded batch from satellite ${satelliteId}: ${parsed.error.message}`,
      );
      return { accepted: 0, rejected: 0, retryable: false };
    }

    const observedAt = now();
    // Cache each token's verdict so a token that also appears in droppedByGroup
    // (but not necessarily in the payload) is verified at most once.
    const verdicts = new Map<
      string,
      Awaited<ReturnType<typeof auth.verify>>
    >();
    const verify = async (token: string) => {
      let verdict = verdicts.get(token);
      if (!verdict) {
        verdict = await auth.verify(token);
        verdicts.set(token, verdict);
      }
      return verdict;
    };
    let accepted = 0;
    let rejected = 0;
    for (const group of parsed.data) {
      if (group.datapoints.length === 0) continue;
      const verdict = await verify(group.streamToken);
      if (!verdict.ok) {
        // Terminal: a bad/revoked token will never authorize this group.
        rejected += group.datapoints.length;
        logger.warn(
          `metricstream: satellite ${satelliteId} forwarded a group with a ${verdict.reason} ` +
            `stream token; rejecting ${group.datapoints.length} datapoint(s)`,
        );
        continue;
      }
      const outcome = sink.ingest({
        streamId: verdict.resourceId,
        datapoints: group.datapoints.map((d) => wireDatapointToNormalized(d)),
        now: observedAt,
      });
      accepted += outcome.accepted;
      rejected += outcome.rejected;
    }

    // Attribute each group's satellite in-transit drops to the EXACT stream that
    // lost data (the group key is the stream token). An unknown/revoked token
    // has no stream to charge, so its loss stays unattributed rather than being
    // smeared across other streams.
    for (const [streamToken, dropped] of Object.entries(droppedByGroup ?? {})) {
      if (dropped <= 0) continue;
      const verdict = await verify(streamToken);
      if (!verdict.ok) {
        logger.debug(
          `metricstream: satellite ${satelliteId} reported ${dropped} in-transit ` +
            `drop(s) for an unresolvable stream token; not attributing`,
        );
        continue;
      }
      await recordInTransitDrop(verdict.resourceId, dropped);
    }
    return { accepted, rejected };
  }

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
        `metricstream: failed to record in-transit drops for stream ${streamId}: ${String(error)}`,
      );
    }
  }

  return {
    kind: METRICSTREAM_TELEMETRY_KIND,
    handleTelemetryBatch,
  };
}
