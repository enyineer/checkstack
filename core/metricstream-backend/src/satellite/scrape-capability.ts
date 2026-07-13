/**
 * The "metric-scrape" satellite capability handler: satellites scrape their
 * BOUND targets and forward the datapoints; core assigns the targets, ingests
 * the forwarded batches, and mirrors per-target scrape health.
 *
 * AUTHORIZATION MODEL: a scrape produces no token. A datapoint batch is
 * authorized purely by the target BINDING - core accepts an entry only when the
 * target exists AND `target.satelliteId === ctx.satelliteId`. A mismatch (a
 * satellite reporting for a target it is not bound to) is rejected and counted,
 * never fed to the sink. This is the same "binding is the authorization" shape
 * the health-result path uses (a satellite may only report for what it is
 * assigned).
 *
 * The handler NEVER duplicates fold logic: forwarded datapoints go through the
 * SAME {@link MetricIngestSink} the HTTP push + core scrape paths use (buffer ->
 * flush -> fold), so ts-clamping, cardinality caps and rollups apply identically.
 *
 * BEARER SECRETS: the bearer NEVER rides the capability_config push (the config
 * re-crosses the wire on every reconnect). The config only flags `hasBearer`; the
 * agent fetches the token JIT via `capability_secret_request` -> {@link resolveSecret},
 * which is binding-authorized and returns the resolved token over the channel only.
 */

import { and, eq, inArray } from "drizzle-orm";
import type { Logger, SafeDatabase } from "@checkstack/backend-api";
import type {
  InternalSecretsService,
  SecretResolverService,
} from "@checkstack/secrets-backend";
import {
  MetricScrapeBatchSchema,
  MetricScrapeSecretRequestSchema,
  MetricScrapeStatusSchema,
  MetricStreamConfigSchema,
  METRIC_SCRAPE_CAPABILITY_KIND,
  wireDatapointToNormalized,
  type MetricScrapeConfig,
  type MetricScrapeSecretResponse,
  type MetricScrapeTargetConfig,
} from "@checkstack/metricstream-common";
import type { SatelliteCapabilityHandler } from "@checkstack/satellite-backend";
import * as schema from "../schema";
import { metricScrapeTargets, metricStreams } from "../schema";
import type { ImportantEventRecorder } from "../events/recorder";
import type { MetricIngestSink } from "../sources/extension-point";
import { addInTransitDrops } from "../storage/activity";
import { resolveScrapeTargetBearer } from "../secrets/scrape-target-secret";
import { SCRAPE_FAILING_THRESHOLD } from "../sources/prometheus/reconciler";

type Db = SafeDatabase<typeof schema>;

export function createMetricScrapeCapabilityHandler({
  db,
  sink,
  recorder,
  internalSecrets,
  secretResolver,
  logger,
  now = () => new Date(),
}: {
  db: Db;
  sink: MetricIngestSink;
  recorder: ImportantEventRecorder;
  /** Internal secret store for scrape-target bearer tokens. */
  internalSecrets: InternalSecretsService;
  /** Secret resolver for `${{ secrets.* }}` bearer references. */
  secretResolver: SecretResolverService;
  logger: Logger;
  now?: () => Date;
}): SatelliteCapabilityHandler {
  /**
   * Build the target set this satellite should scrape: every ENABLED target
   * bound to it, with the stream's seriesCap resolved as `maxSeries` and a
   * `hasBearer` flag (NO secret - the config re-crosses the wire on reconnect).
   * The agent fetches the token JIT via {@link resolveSecret}. Always returns an
   * object (possibly empty) so the agent converges to the exact set - a de-bound
   * / deleted target disappears from the pushed list.
   */
  async function buildCapabilityConfig({
    satelliteId,
  }: {
    satelliteId: string;
  }): Promise<MetricScrapeConfig> {
    const rows = await db
      .select({
        id: metricScrapeTargets.id,
        name: metricScrapeTargets.name,
        url: metricScrapeTargets.url,
        intervalSeconds: metricScrapeTargets.intervalSeconds,
        timeoutMs: metricScrapeTargets.timeoutMs,
        bearerTokenSecret: metricScrapeTargets.bearerTokenSecret,
        streamConfig: metricStreams.config,
      })
      .from(metricScrapeTargets)
      .innerJoin(
        metricStreams,
        eq(metricScrapeTargets.streamId, metricStreams.id),
      )
      .where(
        and(
          eq(metricScrapeTargets.satelliteId, satelliteId),
          eq(metricScrapeTargets.enabled, true),
        ),
      );

    const targets: MetricScrapeTargetConfig[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      url: row.url,
      intervalSeconds: row.intervalSeconds,
      timeoutMs: row.timeoutMs,
      maxSeries: MetricStreamConfigSchema.parse(row.streamConfig ?? {}).seriesCap,
      hasBearer: row.bearerTokenSecret !== null,
    }));
    return { targets };
  }

  /**
   * Resolve a bound target's bearer token JIT (a `capability_secret_request` the
   * WS handler routes here). BINDING IS THE AUTHORIZATION: the token is resolved
   * ONLY when the target exists AND is bound to the requesting satellite - a
   * mismatch/unknown target returns an error without touching the secret store.
   * Returns `{ bearerToken }` (omitted when the target has no bearer). The
   * plaintext is never persisted or logged.
   */
  async function resolveSecret({
    satelliteId,
    payload,
  }: {
    satelliteId: string;
    payload: unknown;
  }): Promise<{ payload?: unknown; error?: string }> {
    const parsed = MetricScrapeSecretRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return { error: "invalid metric-scrape secret request" };
    }
    const { targetId } = parsed.data;

    const [row] = await db
      .select({
        satelliteId: metricScrapeTargets.satelliteId,
        bearerTokenSecret: metricScrapeTargets.bearerTokenSecret,
      })
      .from(metricScrapeTargets)
      .where(eq(metricScrapeTargets.id, targetId))
      .limit(1);

    if (!row || row.satelliteId !== satelliteId) {
      logger.warn(
        `metricstream: rejecting bearer request from satellite ${satelliteId} ` +
          `for target ${targetId} it is not bound to`,
      );
      return { error: "target not bound to this satellite" };
    }

    try {
      const bearerToken = await resolveScrapeTargetBearer({
        stored: row.bearerTokenSecret,
        targetId,
        internalSecrets,
        secretResolver,
      });
      const response: MetricScrapeSecretResponse =
        bearerToken === undefined ? {} : { bearerToken };
      return { payload: response };
    } catch (error) {
      logger.warn(
        `metricstream: failed to resolve bearer for satellite scrape target ${targetId}: ${String(error)}`,
      );
      return { error: "failed to resolve bearer token" };
    }
  }

  /**
   * Ingest one forwarded scrape batch. Each entry is authorized by its target's
   * binding to the sending satellite; datapoints for an unknown / mismatched
   * target are rejected (counted), never fed to the sink. `droppedByGroup`
   * (telemetry the satellite dropped from its own buffer, keyed by scrape target
   * id) is recorded against the EXACT stream each target feeds.
   */
  async function handleTelemetryBatch({
    satelliteId,
    payload,
    droppedByGroup,
  }: {
    satelliteId: string;
    payload: unknown;
    droppedByGroup?: Record<string, number>;
  }): Promise<{ accepted: number; rejected: number; retryable?: boolean }> {
    const parsed = MetricScrapeBatchSchema.safeParse(payload);
    if (!parsed.success) {
      // A malformed batch is terminal, not transient: dropping it (non-retryable)
      // avoids an infinite resend of an un-parseable frame.
      logger.warn(
        `metricstream: dropping malformed metric-scrape batch from satellite ${satelliteId}: ${parsed.error.message}`,
      );
      return { accepted: 0, rejected: 0, retryable: false };
    }

    const entries = parsed.data;
    const dropEntries = Object.entries(droppedByGroup ?? {}).filter(
      ([, count]) => count > 0,
    );
    if (entries.length === 0 && dropEntries.length === 0) {
      return { accepted: 0, rejected: 0 };
    }

    // Resolve every referenced target's binding in ONE query (avoid an N+1) -
    // union of the payload's targets AND any drop-only targets, since a drop can
    // be reported for a target that has no datapoints in this batch.
    const targetIds = [
      ...new Set([
        ...entries.map((e) => e.targetId),
        ...dropEntries.map(([targetId]) => targetId),
      ]),
    ];
    const rows = await db
      .select({
        id: metricScrapeTargets.id,
        streamId: metricScrapeTargets.streamId,
        satelliteId: metricScrapeTargets.satelliteId,
      })
      .from(metricScrapeTargets)
      .where(inArray(metricScrapeTargets.id, targetIds));
    const byId = new Map(rows.map((r) => [r.id, r]));

    const observedAt = now();
    let accepted = 0;
    let rejected = 0;
    for (const entry of entries) {
      const target = byId.get(entry.targetId);
      // BINDING IS THE AUTHORIZATION: reject an unknown target or one bound to a
      // different satellite. Count its datapoints as rejected (dropped).
      if (!target || target.satelliteId !== satelliteId) {
        rejected += entry.datapoints.length;
        logger.warn(
          `metricstream: satellite ${satelliteId} forwarded scrape datapoints for ` +
            `target ${entry.targetId} it is not bound to; rejecting ${entry.datapoints.length} datapoint(s)`,
        );
        continue;
      }
      const outcome = sink.ingest({
        streamId: target.streamId,
        datapoints: entry.datapoints.map((d) => wireDatapointToNormalized(d)),
        now: observedAt,
      });
      accepted += outcome.accepted;
      rejected += outcome.rejected;
    }

    // Attribute each target's satellite in-transit drops to the EXACT stream it
    // feeds, gated by the SAME binding as its datapoints. A drop for an unknown
    // or unbound target has no stream to charge and is left unattributed.
    for (const [targetId, dropped] of dropEntries) {
      const target = byId.get(targetId);
      if (!target || target.satelliteId !== satelliteId) {
        logger.debug(
          `metricstream: satellite ${satelliteId} reported ${dropped} in-transit ` +
            `drop(s) for target ${targetId} it is not bound to; not attributing`,
        );
        continue;
      }
      await recordInTransitDrop(target.streamId, dropped);
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

  /**
   * Mirror per-target scrape health reported by the satellite. Each entry is
   * binding-validated; the row's `lastScrapeAt` / `lastError` /
   * `consecutiveFailures` are updated from the values the agent owns (absolute
   * failure count; omitted = leave unchanged), and a `scrape_failing` event fires
   * on the threshold crossing (reusing the core reconciler's one-event-per-
   * episode semantics).
   */
  async function handleCapabilityStatus({
    satelliteId,
    payload,
  }: {
    satelliteId: string;
    payload: unknown;
  }): Promise<void> {
    const parsed = MetricScrapeStatusSchema.safeParse(payload);
    if (!parsed.success) {
      logger.warn(
        `metricstream: dropping malformed metric-scrape status from satellite ${satelliteId}: ${parsed.error.message}`,
      );
      return;
    }

    for (const entry of parsed.data) {
      const [row] = await db
        .select({
          id: metricScrapeTargets.id,
          name: metricScrapeTargets.name,
          streamId: metricScrapeTargets.streamId,
          satelliteId: metricScrapeTargets.satelliteId,
          consecutiveFailures: metricScrapeTargets.consecutiveFailures,
        })
        .from(metricScrapeTargets)
        .where(eq(metricScrapeTargets.id, entry.targetId))
        .limit(1);

      // Binding validation: ignore status for a target this satellite is not
      // bound to (a stale report after a rebind, or a forged one).
      if (!row || row.satelliteId !== satelliteId) {
        logger.warn(
          `metricstream: ignoring metric-scrape status from satellite ${satelliteId} ` +
            `for target ${entry.targetId} it is not bound to`,
        );
        continue;
      }

      const previousFailures = row.consecutiveFailures;
      // Absolute count owned by the agent; omitted => leave the counter as-is.
      const nextFailures = entry.consecutiveFailures ?? previousFailures;
      await db
        .update(metricScrapeTargets)
        .set({
          lastScrapeAt: entry.lastScrapeAt ? new Date(entry.lastScrapeAt) : null,
          lastError: entry.lastError,
          consecutiveFailures: nextFailures,
          updatedAt: now(),
        })
        .where(eq(metricScrapeTargets.id, entry.targetId));

      // Fire exactly on the threshold crossing (one event per outage episode),
      // mirroring the core reconciler. Absolute reporting can jump past the
      // threshold, so detect the crossing rather than an exact hit.
      if (
        previousFailures < SCRAPE_FAILING_THRESHOLD &&
        nextFailures >= SCRAPE_FAILING_THRESHOLD &&
        entry.lastError
      ) {
        try {
          await recorder.record({
            streamId: row.streamId,
            ts: now(),
            type: "scrape_failing",
            title: `Scrape target "${row.name}" is failing`,
            detail: {
              targetId: row.id,
              satelliteId,
              consecutiveFailures: nextFailures,
              lastError: entry.lastError,
            },
          });
        } catch (error) {
          logger.warn(
            `metricstream: failed to record scrape_failing event for satellite target ${row.id}: ${String(error)}`,
          );
        }
      }
    }
  }

  return {
    kind: METRIC_SCRAPE_CAPABILITY_KIND,
    buildCapabilityConfig,
    resolveSecret,
    handleTelemetryBatch,
    handleCapabilityStatus,
  };
}
