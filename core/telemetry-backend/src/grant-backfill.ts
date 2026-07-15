/**
 * One-shot boot backfill of team grants for MIGRATED source instances.
 *
 * The platform promotions (drizzle migrations 0001 scrape-target and 0002
 * push-token) created `telemetry_sources` rows for pre-existing shipper/scrape
 * configs but wrote NO `telemetry.source` team relations. A team-scoped user
 * (a grant on the bound stream, but no global rule) is therefore locked out of
 * those migrated instances - every rotate/update/delete 403s, and the source is
 * hidden by the list `listKey` post-filter. This backfill copies each migrated
 * source's access from the streams it is bound to, ONCE per installation.
 *
 * It is deliberately a ONE-SHOT, not continuous policy: it runs only for the
 * four promoted source types, only for sources that today have ZERO team
 * relations, and records a completion marker in the internal-secret store so
 * later boots skip instantly. A global admin's future grant-less sources must
 * stay global-only - re-running would wrongly team-scope them.
 *
 * Coherence & scale (state-and-scale rule): a cross-pod advisory lock elects a
 * single pod to run the scan; the marker lives in the shared secret store, so
 * every pod sees "done" on the next boot. Best-effort and fail-open: a per-source
 * error is logged and skipped, and a SYSTEMIC failure (every source errored,
 * e.g. auth unreachable) leaves the marker UNSET so the next boot retries.
 */

import { inArray } from "drizzle-orm";
import type {
  AdvisoryLockService,
  Logger,
  RpcClient,
  SafeDatabase,
} from "@checkstack/backend-api";
import type { InternalSecretsService } from "@checkstack/secrets-backend";
import { AuthApi } from "@checkstack/auth-common";
import {
  telemetryResourceTypes,
  type SourceBinding,
} from "@checkstack/telemetry-common";
import * as schema from "./schema";
import { telemetrySources } from "./schema";
import type { TelemetrySinkRegistry } from "./extension-points";

type Db = SafeDatabase<typeof schema>;

/**
 * Qualified source-type ids the promotions created rows for WITHOUT team grants.
 * ONLY these are backfilled - a source of any other type keeps whatever grant
 * state its create path wrote (global-only stays global-only).
 */
export const PROMOTED_SOURCE_TYPE_IDS = [
  "logstream.push",
  "metricstream.push",
  "tracestream.push",
  "metricstream.prometheus-scrape",
] as const;

/** Internal-secret marker parts recording that the one-shot has completed. */
export const PROMOTED_GRANTS_BACKFILL_MARKER = ["backfill", "promoted-grants"];

/** Advisory-lock key electing the single pod that runs the scan. */
export const PROMOTED_GRANTS_BACKFILL_LOCK_KEY =
  "telemetry:promoted-grants-backfill";

/**
 * The narrow slice of the S2S `forPlugin(AuthApi)` client this backfill uses.
 * Structural so a unit test can pass a fake without a live RPC stack.
 */
export interface GrantBackfillAuthClient {
  listObjectRelations(input: {
    objectType: string;
    objectId: string;
  }): Promise<{
    teams: {
      teamId: string;
      teamName: string;
      relation: "viewer" | "editor" | "owner";
    }[];
    isPublic: boolean;
  }>;
  setOwner(input: {
    objectType: string;
    objectId: string;
    teamId: string;
    isPrivate?: boolean;
  }): Promise<void>;
  writeRelation(input: {
    objectType: string;
    objectId: string;
    teamId: string;
    relation: "viewer" | "editor";
  }): Promise<void>;
  setObjectPublic(input: {
    objectType: string;
    objectId: string;
    isPublic: boolean;
  }): Promise<void>;
}

export async function backfillPromotedSourceGrants({
  db,
  sinkRegistry,
  rpcClient,
  internalSecrets,
  advisoryLock,
  logger,
}: {
  db: Db;
  sinkRegistry: TelemetrySinkRegistry;
  rpcClient: RpcClient;
  internalSecrets: InternalSecretsService;
  advisoryLock: AdvisoryLockService;
  logger: Logger;
}): Promise<void> {
  // Fast path (before taking any lock): later boots skip instantly.
  if (await isDone(internalSecrets)) return;

  const lock = await advisoryLock.tryAcquire(PROMOTED_GRANTS_BACKFILL_LOCK_KEY);
  if (!lock) {
    logger.debug(
      "telemetry: promoted-grants backfill running on another pod, skipping",
    );
    return;
  }

  try {
    // Re-check inside the lock: another pod may have just finished and marked
    // done between the fast-path read and acquiring the lock.
    if (await isDone(internalSecrets)) return;

    const auth: GrantBackfillAuthClient = rpcClient.forPlugin(AuthApi);
    const rows = await db
      .select({
        id: telemetrySources.id,
        bindings: telemetrySources.bindings,
      })
      .from(telemetrySources)
      .where(inArray(telemetrySources.sourceTypeId, [...PROMOTED_SOURCE_TYPE_IDS]));

    let backfilled = 0;
    let failures = 0;
    for (const source of rows) {
      try {
        const existing = await auth.listObjectRelations({
          objectType: telemetryResourceTypes.source,
          objectId: source.id,
        });
        // Already has grants (created post-migration, or a prior partial run):
        // leave it exactly as-is so this can never re-scope a global-only source.
        if (existing.teams.length > 0) continue;
        const wrote = await copyBindingGrants({
          auth,
          sourceId: source.id,
          bindings: source.bindings,
          sinkRegistry,
          logger,
        });
        if (wrote) backfilled += 1;
      } catch (error) {
        failures += 1;
        logger.warn(
          `telemetry: promoted-grants backfill failed for source ${source.id}: ${String(error)}`,
        );
      }
    }

    // Systemic failure (every source errored - e.g. auth unreachable): do NOT
    // mark done, so the next boot retries. Otherwise the scan completed; record
    // the marker so it never runs again.
    if (rows.length > 0 && failures === rows.length) {
      logger.warn(
        "telemetry: promoted-grants backfill: every source failed; leaving it unmarked to retry on next boot",
      );
      return;
    }
    await internalSecrets.set({
      parts: PROMOTED_GRANTS_BACKFILL_MARKER,
      value: "done",
    });
    if (backfilled > 0) {
      logger.info(
        `telemetry: backfilled team grants for ${backfilled} migrated source(s) from their bound streams`,
      );
    }
  } finally {
    await lock.release();
  }
}

async function isDone(
  internalSecrets: InternalSecretsService,
): Promise<boolean> {
  return (
    (await internalSecrets.get({ parts: PROMOTED_GRANTS_BACKFILL_MARKER })) ===
    "done"
  );
}

/**
 * Copy the team access of a source's bound streams onto the source itself.
 * Owner relations are written via `setOwner` (the only S2S way to create an
 * owner grant), viewer/editor via `writeRelation`; if ANY bound stream is
 * public, the source is marked public too so a global-rule reader keeps the
 * read access the pre-grant (global-only) source gave them. A binding whose
 * sink does not declare `streamResourceType` is skipped with a warning.
 *
 * Returns true if it wrote at least one relation (so the caller can count it).
 */
async function copyBindingGrants({
  auth,
  sourceId,
  bindings,
  sinkRegistry,
  logger,
}: {
  auth: GrantBackfillAuthClient;
  sourceId: string;
  bindings: SourceBinding[];
  sinkRegistry: TelemetrySinkRegistry;
  logger: Logger;
}): Promise<boolean> {
  let wrote = false;
  let anyPublic = false;
  for (const binding of bindings) {
    const streamResourceType = sinkRegistry.get(binding.signal)?.streamResourceType;
    if (!streamResourceType) {
      logger.warn(
        `telemetry: no streamResourceType for signal "${binding.signal}"; skipping grant backfill for that binding of source ${sourceId}`,
      );
      continue;
    }
    const { teams, isPublic } = await auth.listObjectRelations({
      objectType: streamResourceType,
      objectId: binding.streamId,
    });
    if (isPublic) anyPublic = true;
    for (const team of teams) {
      // Owner is only writable S2S via setOwner; viewer/editor via writeRelation.
      // `isPrivate: true` keeps the relation write independent of visibility - the
      // public marker is applied once below to mirror the bound stream(s).
      await (team.relation === "owner"
        ? auth.setOwner({
            objectType: telemetryResourceTypes.source,
            objectId: sourceId,
            teamId: team.teamId,
            isPrivate: true,
          })
        : auth.writeRelation({
            objectType: telemetryResourceTypes.source,
            objectId: sourceId,
            teamId: team.teamId,
            relation: team.relation,
          }));
      wrote = true;
    }
  }
  if (anyPublic) {
    await auth.setObjectPublic({
      objectType: telemetryResourceTypes.source,
      objectId: sourceId,
      isPublic: true,
    });
  }
  return wrote;
}
