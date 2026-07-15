/**
 * One-shot secret re-key for MIGRATED Prometheus scrape targets.
 *
 * The telemetry migration copies each `metric_scrape_targets` row's
 * `bearer_token_secret` VERBATIM into the new `telemetry_sources.config.bearerToken`.
 * That value may be an OLD metricstream inline-secret marker
 * (`__mssecret__:<targetId>`) which points at a plaintext token in metricstream's
 * OWN internal-secret store - a store the TELEMETRY platform does not key. Left
 * as-is, telemetry would treat the marker as a literal and send it as the bearer
 * header. This pass rewrites those markers so the token lives under telemetry's
 * own `__tlsecret__` channel:
 *
 *   1. List every `metricstream.prometheus-scrape` telemetry source.
 *   2. For each whose `config.bearerToken` is a metricstream marker, resolve the
 *      plaintext from metricstream's internal store (keyed by the OLD target id,
 *      which the migration reused as the new source id).
 *   3. Re-store it through telemetry's PUBLIC update path (S2S `updateSource`
 *      with the plaintext), so the platform re-encrypts it under
 *      `__tlsecret__:<sourceId>:bearerToken` and strips it on read.
 *
 * `${{ secrets.NAME }}` references pass through UNCHANGED - they are resolver
 * refs, not markers, and are resolved fresh at run time (see the source type's
 * `resolveBearer`). A plaintext/legacy literal is likewise left alone.
 *
 * IDEMPOTENT: after a re-key the marker is gone (the field holds a `__tlsecret__`
 * marker, stripped from the read DTO), so a re-run finds nothing to do. An
 * advisory lock keeps concurrent pods from all doing the (idempotent) work at
 * boot. After a SUCCESSFUL re-key the metricstream internal secret the pass read
 * is DELETED, so no orphaned secret survives once the token lives under
 * telemetry's own `__tlsecret__` channel (this release drops the legacy
 * `metric_stream_tokens` / `metric_scrape_targets` tables the migration copied
 * from; the internal-secret store outlives them, so it is cleaned up here rather
 * than left for a later release). The delete is best-effort - it runs only after
 * `updateSource` committed the re-encrypted token, so a failed delete leaves a
 * harmless orphan, never an unresolvable bearer.
 */

import type { AdvisoryLockService, Logger, RpcClient } from "@checkstack/backend-api";
import type { InternalSecretsService } from "@checkstack/secrets-backend";
import { isConfigSecretMarker } from "@checkstack/secrets-common";
import { TelemetryApi } from "@checkstack/telemetry-common";
import {
  METRICSTREAM_SECRET_MARKER_PREFIX,
  scrapeBearerKeyParts,
  clearScrapeTargetBearer,
} from "../../secrets/scrape-target-secret";
import {
  PROMETHEUS_SCRAPE_BEARER_FIELD,
  PROMETHEUS_SCRAPE_QUALIFIED_ID,
} from "./source-type";

/** Advisory-lock key so only one pod runs the (idempotent) re-key at a time. */
const REKEY_LOCK_KEY = "metricstream.rekey-scrape-bearers";

export async function rekeyMigratedScrapeBearers({
  rpcClient,
  internalSecrets,
  advisoryLock,
  logger,
}: {
  rpcClient: RpcClient;
  internalSecrets: InternalSecretsService;
  advisoryLock: AdvisoryLockService;
  logger: Logger;
}): Promise<void> {
  const lock = await advisoryLock.tryAcquire(REKEY_LOCK_KEY);
  // Another pod holds the lock and is running (or ran) the pass; idempotency makes
  // skipping safe.
  if (!lock) return;

  try {
    const client = rpcClient.forPlugin(TelemetryApi);
    const { sources } = await client.listSources({
      sourceTypeId: PROMETHEUS_SCRAPE_QUALIFIED_ID,
    });

    let rekeyed = 0;
    for (const source of sources) {
      const bearer = source.config[PROMETHEUS_SCRAPE_BEARER_FIELD];
      if (typeof bearer !== "string") continue;
      // Only an OLD metricstream inline-secret marker needs re-keying; a
      // `${{ }}` reference or a plaintext literal is left untouched.
      if (!isConfigSecretMarker(METRICSTREAM_SECRET_MARKER_PREFIX, bearer)) {
        continue;
      }

      // Isolate each source: one source whose updateSource is rejected (e.g. a
      // config the current schema no longer accepts) must NOT abort the pass and
      // leave every LATER source's marker un-re-keyed. Warn with the id and
      // continue; the next boot retries the ones left behind.
      try {
        const plaintext = await internalSecrets.get({
          parts: scrapeBearerKeyParts(source.id),
        });
        if (plaintext === undefined) {
          logger.warn(
            `metricstream: re-key found a migrated scrape source (${source.id}) with a ` +
              "metricstream bearer marker but no stored secret; leaving the marker in place",
          );
          continue;
        }

        // Re-store through telemetry's public update path: `config` REPLACES the
        // stored config (secret markers aside), so pass the full config with the
        // marker swapped for the plaintext. Telemetry re-encrypts it under its
        // own `__tlsecret__` channel and strips it from reads.
        await client.updateSource({
          id: source.id,
          body: {
            config: {
              ...source.config,
              [PROMETHEUS_SCRAPE_BEARER_FIELD]: plaintext,
            },
          },
        });
        rekeyed += 1;

        // The token now lives under telemetry's own `__tlsecret__` channel;
        // delete the metricstream internal secret we read so no orphan survives
        // the dropped legacy table. Best-effort AFTER the successful update -
        // a failed delete leaves a harmless orphan, never an unresolvable bearer.
        try {
          await clearScrapeTargetBearer({ internalSecrets, targetId: source.id });
        } catch (error) {
          logger.warn(
            `metricstream: re-keyed scrape source ${source.id} but failed to delete ` +
              `its orphaned internal secret: ${String(error)}`,
          );
        }
      } catch (error) {
        logger.warn(
          `metricstream: failed to re-key migrated scrape source ${source.id}; ` +
            `leaving the marker for the next boot: ${String(error)}`,
        );
      }
    }

    if (rekeyed > 0) {
      logger.info(
        `metricstream: re-keyed ${rekeyed} migrated Prometheus scrape bearer token(s) ` +
          "into the telemetry secret store",
      );
    }
  } catch (error) {
    // Best-effort: a failure just leaves markers for the next boot to retry.
    logger.warn(
      `metricstream: Prometheus scrape bearer re-key pass failed: ${String(error)}`,
    );
  } finally {
    await lock.release();
  }
}
