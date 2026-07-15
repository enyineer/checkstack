/**
 * Source-instance service: the contract handlers' business logic. Reads/writes
 * the single `telemetry_sources` table, brokers the config-secret channel
 * ({@link ./secrets}), authorizes stream bindings through the owning sinks, and
 * runs editor config tests with a counting (non-writing) sink.
 *
 * RLAC note: the caller's grant on the source instance is enforced by
 * `autoAuthMiddleware` from the contract's `instanceAccess` (idParam / listKey /
 * create / typeScoped). This service adds the SECOND authorization the platform
 * cannot express in a contract: manage on every bound stream, via the owning
 * sink's `assertBindable`. It never re-checks the source grant.
 */

import { ORPCError } from "@orpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { extractErrorMessage, isSecretClearSentinel } from "@checkstack/common";
import type {
  AuthUser,
  EventBus,
  Logger,
  RpcClient,
  SafeDatabase,
} from "@checkstack/backend-api";
import { AuthApi } from "@checkstack/auth-common";
import { createSourceTokenKit, type SourceTokenKit } from "@checkstack/ingest-utils";
import type { SignalService } from "@checkstack/signal-common";
import {
  TELEMETRY_SOURCE_CHANGED,
  telemetryResourceTypes,
  type BindableStream,
  type CreateTelemetrySource,
  type PushInfo,
  type SourceBinding,
  type SourceTypeDescriptor,
  type TelemetrySignal,
  type TelemetrySource,
  type TestSourceConfigResult,
  type UpdateTelemetrySource,
  type WebhookInfo,
} from "@checkstack/telemetry-common";
import * as schema from "./schema";
import { telemetrySources, type TelemetrySourceRow } from "./schema";
import {
  telemetryPushTokenInvalidatedHook,
  telemetrySourceReconcileHook,
} from "./events";
import {
  listSecretFields,
  stripSecretsForRead,
  partitionSecretsForWrite,
  type SourceSecretStore,
} from "./secrets";
import { createCountingSink } from "./bound-sink";
import { createGuardedFetch, type GuardedLookupFn } from "@checkstack/backend-api";
import { clampInterval } from "./reconciler";
import { webhookPath } from "./webhooks";
import type { SatelliteBindingAuthorizer } from "./satellite/binding-auth";
import {
  toSourceTypeDescriptor,
  type RegisteredTelemetrySourceType,
  type TelemetrySinkRegistry,
  type TelemetrySourceRegistry,
} from "./extension-points";

/** Default per-run budget for the editor config-test dry run. */
export const CONFIG_TEST_TIMEOUT_MS = 10_000;

type Db = SafeDatabase<typeof schema>;

/** Post-CRUD reconcile hooks (wired to the pull reconciler in setup). */
export interface SourceReconcileHooks {
  scheduleSource(input: { sourceId: string }): Promise<void>;
  unscheduleSource(input: { sourceId: string }): Promise<void>;
}

/**
 * Post-CRUD satellite re-push hook (wired to
 * `SatelliteCapabilityRegistry.notifyCapabilityConfigChanged` in setup). Called
 * for every satellite whose bound instance set changed (BOTH old and new on a
 * move), so the affected satellites converge their pull config immediately. A
 * best-effort optimization on top of the satellite's own reconnect re-push;
 * optional so tests can omit it.
 */
export interface SatelliteConfigPush {
  notifyConfigChanged(input: { satelliteId: string }): void;
}

/**
 * The narrow source-lifecycle surface a SIGNAL-OWNING plugin consumes (via
 * `telemetrySourceLifecycleRef`) to keep source bindings coherent when it
 * deletes a stream. Dependency direction is preserved: the stream plugin
 * imports the platform and calls IN; the platform never imports a stream plugin.
 */
export interface TelemetrySourceLifecycle {
  /**
   * React to a stream being deleted in the owning plugin: every source bound to
   * `{ signal, streamId }` has that binding stripped. A source left with NO
   * bindings is fully deleted (secret cleanup, unschedule, reconcile broadcast,
   * push-token "revoked"); a source that keeps other bindings is persisted with
   * the reduced set and its cached push verdict is evicted ("revoked"), since
   * the removed binding may be embedded in a warm pod's cached verdict.
   *
   * Idempotent and best-effort-safe: a `streamId` matching no source is a no-op,
   * and it is safe to call AFTER the stream row itself is already gone (the
   * platform only touches its own `telemetry_sources` rows).
   */
  handleStreamDeleted(input: {
    signal: TelemetrySignal;
    streamId: string;
  }): Promise<void>;
}

export interface TelemetryService extends TelemetrySourceLifecycle {
  listSourceTypes(input?: {
    signal?: TelemetrySignal;
  }): Promise<{ sourceTypes: SourceTypeDescriptor[] }>;
  createSource(input: {
    input: CreateTelemetrySource;
    user: AuthUser | undefined;
    /** Caller's request headers, forwarded to the satellite-binding gate. */
    requestHeaders?: Headers;
  }): Promise<TelemetrySource & { webhook?: WebhookInfo; push?: PushInfo }>;
  updateSource(input: {
    id: string;
    body: UpdateTelemetrySource;
    user: AuthUser | undefined;
    /** Caller's request headers, forwarded to the satellite-binding gate. */
    requestHeaders?: Headers;
  }): Promise<TelemetrySource>;
  deleteSource(input: { id: string }): Promise<void>;
  getSource(input: { id: string }): Promise<TelemetrySource>;
  listSources(input?: {
    streamId?: string;
    signal?: TelemetrySignal;
    sourceTypeId?: string;
  }): Promise<{ sources: TelemetrySource[] }>;
  /**
   * List the streams the caller may BIND for a signal (binding editor picker).
   * Delegates to the signal's sink, which filters by its own access rules;
   * yields an empty list when no sink is registered or the sink has not adopted
   * the optional lister yet.
   */
  listBindableStreams(input: {
    signal: TelemetrySignal;
    user: AuthUser | undefined;
  }): Promise<{ streams: BindableStream[] }>;
  rotateWebhookSecret(input: { id: string }): Promise<WebhookInfo>;
  /**
   * Rotate a push-mode instance's bearer token. The previous token stops
   * verifying (a "revoked" invalidation for its hash) and a new one is minted
   * ("minted" for the new hash); the new token is shown ONCE.
   */
  rotatePushToken(input: { id: string }): Promise<PushInfo>;
  /** Resolve a stored config's secrets to plaintext and parse for a run. */
  resolveRunnableConfig(input: {
    sourceId: string;
    sourceTypeId: string;
    config: Record<string, unknown>;
  }): Promise<unknown>;
  runConfigTest(input: {
    sourceTypeId: string;
    config: Record<string, unknown>;
    sourceId?: string;
  }): Promise<TestSourceConfigResult>;
  /**
   * Enabled instances bound to a satellite, for the satellite pull-capability
   * handler to push down. Read DTOs (secrets stripped); the handler resolves
   * config per row via {@link resolveRunnableConfig} at push time.
   */
  listSatelliteSources(input: {
    satelliteId: string;
  }): Promise<{ sources: TelemetrySource[] }>;
}

// =============================================================================
// PURE VALIDATORS (exported for unit testing)
// =============================================================================

/** Reject a binding for a signal the type cannot emit. */
export function assertSignalsSubset({
  type,
  bindings,
}: {
  type: { signals: TelemetrySignal[] };
  bindings: SourceBinding[];
}): void {
  const emittable = new Set(type.signals);
  for (const binding of bindings) {
    if (!emittable.has(binding.signal)) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Source type does not emit signal "${binding.signal}"`,
      });
    }
  }
}

/**
 * Authorize EVERY binding: require a registered sink for the signal (else the
 * owning plugin is not installed) and delegate the manage-on-stream check to the
 * sink's `assertBindable`. Runs for all bindings on create and whenever bindings
 * change on update (added AND kept), because the caller must still manage them.
 */
export async function assertBindingsAuthorized({
  bindings,
  sinkRegistry,
  user,
}: {
  bindings: SourceBinding[];
  sinkRegistry: TelemetrySinkRegistry;
  user: AuthUser | undefined;
}): Promise<void> {
  if (!user) {
    throw new ORPCError("UNAUTHORIZED", { message: "Authentication required" });
  }
  for (const binding of bindings) {
    const sink = sinkRegistry.get(binding.signal);
    if (!sink) {
      throw new ORPCError("BAD_REQUEST", {
        message: `No sink for signal "${binding.signal}" — is the owning plugin installed?`,
      });
    }
    await sink.assertBindable({ streamId: binding.streamId, user });
  }
}

// =============================================================================
// SERVICE
// =============================================================================

export function createTelemetryService({
  db,
  sourceRegistry,
  sinkRegistry,
  internalSecretsStore,
  signalService,
  eventBus,
  webhookKit,
  reconcile,
  assertSatelliteBindable,
  satellitePush,
  rpcClient,
  logger,
  now = () => new Date(),
  lookupFn,
}: {
  db: Db;
  sourceRegistry: TelemetrySourceRegistry;
  sinkRegistry: TelemetrySinkRegistry;
  /** Config-secret channel (constructed from InternalSecretsService in setup). */
  internalSecretsStore: SourceSecretStore;
  signalService: SignalService;
  /** Backend event bus for cross-pod listener convergence (optional in tests). */
  eventBus?: EventBus;
  /** ckwh_ kit for minting/hashing webhook secrets. */
  webhookKit: SourceTokenKit;
  reconcile: SourceReconcileHooks;
  /**
   * SSRF-pivot guard: verifies the CALLER may bind a non-null satelliteId,
   * re-entering the satellite RPC as the caller (see `satellite/binding-auth`).
   * Required - a source instance's satelliteId is caller-supplied.
   */
  assertSatelliteBindable: SatelliteBindingAuthorizer;
  /** Optional post-CRUD satellite re-push hook (wired in setup). */
  satellitePush?: SatelliteConfigPush;
  /**
   * S2S RPC client, used to delete a source's team relations via
   * `AuthApi.deleteObjectRelations` when it is fully removed (delete or an
   * orphaning stream-deletion cascade). Optional so lightweight tests can omit
   * it; when absent, grant cleanup is skipped with a warning.
   */
  rpcClient?: RpcClient;
  logger: Logger;
  now?: () => Date;
  /** DNS resolver seam for guarded fetch in the config test (tests inject). */
  lookupFn?: GuardedLookupFn;
}): TelemetryService {
  const secretStore = internalSecretsStore;

  /**
   * One {@link SourceTokenKit} per push token prefix, built lazily and memoized
   * (each push type carries a stable `tokenPrefix`). Mirrors the single shared
   * `webhookKit`, but keyed per type since prefixes differ across push types.
   */
  const pushKits = new Map<string, SourceTokenKit>();
  function pushKitFor(prefix: string): SourceTokenKit {
    let kit = pushKits.get(prefix);
    if (!kit) {
      kit = createSourceTokenKit({ prefix });
      pushKits.set(prefix, kit);
    }
    return kit;
  }

  /**
   * Emit the cross-pod push-token invalidation hook so every endpoint owner's
   * ingest-auth caches converge (see {@link telemetryPushTokenInvalidatedHook}).
   * Best-effort: a bus failure is logged and never fails the mutation; the 60s
   * positive-cache TTL bounds the stale window if the event is lost.
   */
  async function emitPushTokenInvalidated(input: {
    sourceTypeId: string;
    sourceId: string;
    tokenHash: string;
    reason: "minted" | "revoked";
  }): Promise<void> {
    try {
      await eventBus?.emit(telemetryPushTokenInvalidatedHook, input);
    } catch (error) {
      logger.warn(
        `telemetry: failed to emit push-token invalidation (${input.reason}) for ${input.sourceId}: ${String(error)}`,
      );
    }
  }

  function requireType(sourceTypeId: string): RegisteredTelemetrySourceType {
    const type = sourceRegistry.get(sourceTypeId);
    if (!type) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Unknown source type "${sourceTypeId}"`,
      });
    }
    return type;
  }

  async function loadRowOrThrow(id: string): Promise<TelemetrySourceRow> {
    const [row] = await db
      .select()
      .from(telemetrySources)
      .where(eq(telemetrySources.id, id))
      .limit(1);
    if (!row) {
      throw new ORPCError("NOT_FOUND", { message: "Source not found" });
    }
    return row;
  }

  async function broadcastChanged(
    sourceId: string,
    reason: "created" | "updated" | "deleted",
  ): Promise<void> {
    // Frontend-facing signal (query invalidation).
    try {
      await signalService.broadcast(TELEMETRY_SOURCE_CHANGED, { sourceId });
    } catch (error) {
      logger.warn(
        `telemetry: failed to broadcast source_changed for ${sourceId}: ${String(error)}`,
      );
    }
    // Backend cross-pod path (listener convergence). Best-effort: a manager's
    // own boot reconcile is the backstop if the bus is delayed.
    try {
      await eventBus?.emit(telemetrySourceReconcileHook, { sourceId, reason });
    } catch (error) {
      logger.warn(
        `telemetry: failed to emit source-changed hook for ${sourceId}: ${String(error)}`,
      );
    }
  }

  /**
   * Ask each affected satellite to rebuild its pull config. De-dupes and drops
   * nulls (a core-executed instance has no satellite). Fire-and-forget: the
   * satellite's own reconnect re-push is the backstop.
   */
  function notifySatellites(ids: (string | null)[]): void {
    if (!satellitePush) return;
    for (const satelliteId of new Set(ids)) {
      if (satelliteId) satellitePush.notifyConfigChanged({ satelliteId });
    }
  }

  /**
   * Fully remove a source row and everything hanging off it: stored secrets, its
   * pull schedule, and its push-token verdict. Shared by {@link deleteSource} and
   * the empty-bindings branch of {@link handleStreamDeleted} so both take the
   * exact same teardown path.
   */
  async function purgeSource(existing: TelemetrySourceRow): Promise<void> {
    await db
      .delete(telemetrySources)
      .where(eq(telemetrySources.id, existing.id));
    try {
      await secretStore.clearAll({
        config: existing.config,
        sourceId: existing.id,
      });
      // Clear any stored HMAC key too (idempotent; a no-op for plain-secret or
      // non-webhook types that never stored one).
      await secretStore.clearWebhookSecret({ sourceId: existing.id });
    } catch (error) {
      logger.warn(
        `telemetry: failed to clear secrets for deleted source ${existing.id}: ${String(error)}`,
      );
    }
    await reconcile.unscheduleSource({ sourceId: existing.id });
    await broadcastChanged(existing.id, "deleted");
    // Delete the source's team relations so no grant orphans remain. Idempotent
    // (deletes every tuple for the object; a second call is a no-op), so it is
    // safe on BOTH the RPC delete path and the stream-deletion cascade.
    await deleteSourceGrants(existing.id);
    // A deleted push instance's token stops verifying: revoke its hash so every
    // pod drops the positive cache (TTL-bounded if the event is lost).
    if (existing.pushTokenHash) {
      await emitPushTokenInvalidated({
        sourceTypeId: existing.sourceTypeId,
        sourceId: existing.id,
        tokenHash: existing.pushTokenHash,
        reason: "revoked",
      });
    }
    notifySatellites([existing.satelliteId]);
  }

  /**
   * Best-effort delete of a source's ReBAC team grants via auth's
   * `deleteObjectRelations`, keyed on the SAME qualified type the access rule
   * grants on (`telemetry.source`). The row is already gone, so an auth-RPC
   * failure is logged, never rethrown. Skipped (with a warning) when no
   * rpcClient is wired.
   */
  async function deleteSourceGrants(sourceId: string): Promise<void> {
    if (!rpcClient) {
      logger.warn(
        `telemetry: rpcClient not provided; skipped team-grant cleanup for deleted source ${sourceId} (grants may orphan).`,
      );
      return;
    }
    try {
      await rpcClient.forPlugin(AuthApi).deleteObjectRelations({
        objectType: telemetryResourceTypes.source,
        objectId: sourceId,
      });
    } catch (error) {
      logger.warn(
        `telemetry: failed to delete team grants for source ${sourceId}: ${String(error)}`,
      );
    }
  }

  /**
   * Persist a REDUCED binding set on a source that still has bindings after a
   * stream it referenced was deleted, and evict its cached push verdict (the
   * removed binding may be embedded in a warm pod's cached verdict).
   */
  async function unbindAndPersist(
    existing: TelemetrySourceRow,
    remaining: SourceBinding[],
  ): Promise<void> {
    await db
      .update(telemetrySources)
      .set({ bindings: remaining, updatedAt: now() })
      .where(eq(telemetrySources.id, existing.id));
    await reconcile.scheduleSource({ sourceId: existing.id });
    await broadcastChanged(existing.id, "updated");
    if (existing.pushTokenHash) {
      await emitPushTokenInvalidated({
        sourceTypeId: existing.sourceTypeId,
        sourceId: existing.id,
        tokenHash: existing.pushTokenHash,
        reason: "revoked",
      });
    }
    notifySatellites([existing.satelliteId]);
  }

  return {
    async listSourceTypes(input) {
      const descriptors = sourceRegistry
        .list()
        .map((registered) => toSourceTypeDescriptor(registered))
        .filter(
          (d) => !input?.signal || d.signals.includes(input.signal),
        );
      return { sourceTypes: descriptors };
    },

    async createSource({ input, user, requestHeaders }) {
      const type = requireType(input.sourceTypeId);
      assertSignalsSubset({ type, bindings: input.bindings });
      await assertBindingsAuthorized({
        bindings: input.bindings,
        sinkRegistry,
        user,
      });

      const id = crypto.randomUUID();
      const secretFields = listSecretFields(type.configSchema);
      const { configToStore, toStore } = partitionSecretsForWrite({
        incomingConfig: input.config,
        secretFields,
        sourceId: id,
      });
      const parsedConfig = parseConfig({ type, config: configToStore });

      const intervalSeconds = resolveInterval({
        type,
        requested: input.intervalSeconds,
      });
      const satelliteId = input.satelliteId ?? null;
      assertSatelliteAllowed({ type, satelliteId });
      // SSRF-pivot guard: a non-null satelliteId must be one the caller can bind
      // (readable + telemetry-pull capable). Runs BEFORE any persistence.
      if (typeof satelliteId === "string") {
        await assertSatelliteBindable({ satelliteId, requestHeaders });
      }

      // Mint the webhook secret once for a webhook-capable type.
      let webhook: WebhookInfo | undefined;
      let webhookSecretHash: string | null = null;
      let webhookSecretPrefix: string | null = null;
      if (type.webhook) {
        const generated = webhookKit.generateToken({ resourceId: id });
        webhookSecretHash = generated.tokenHash;
        webhookSecretPrefix = generated.tokenPrefix;
        webhook = { path: webhookPath(id), secret: generated.secret };
        // A signature-verifying type needs the RAW secret as the HMAC key, so
        // store it encrypted at rest (hash-only storage cannot key an HMAC).
        // Plain-secret types keep hash-only storage.
        if (type.webhook.signature) {
          await secretStore.setWebhookSecret({
            sourceId: id,
            secret: generated.secret,
          });
        }
      }

      // Mint the push bearer token once for a push-capable type (hash-only
      // storage, shown once). Endpoint owners verify presented tokens through
      // the push-token verifier service.
      let push: PushInfo | undefined;
      let pushTokenHash: string | null = null;
      let pushTokenPrefix: string | null = null;
      if (type.push) {
        const generated = pushKitFor(type.push.tokenPrefix).generateToken({
          resourceId: id,
        });
        pushTokenHash = generated.tokenHash;
        pushTokenPrefix = generated.tokenPrefix;
        push = { token: generated.secret, endpoints: type.push.endpoints };
      }

      await secretStore.apply({ sourceId: id, toStore, toClear: [] });

      const createdAt = now();
      const [row] = await db
        .insert(telemetrySources)
        .values({
          id,
          sourceTypeId: input.sourceTypeId,
          name: input.name,
          description: input.description ?? null,
          config: parsedConfig,
          bindings: input.bindings,
          enabled: input.enabled,
          intervalSeconds,
          satelliteId,
          webhookSecretHash,
          webhookSecretPrefix,
          pushTokenHash,
          pushTokenPrefix,
          createdAt,
          updatedAt: createdAt,
        })
        .returning();
      if (!row) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Failed to create source",
        });
      }

      await reconcile.scheduleSource({ sourceId: id });
      await broadcastChanged(id, "created");
      // A freshly-minted push token: clear any negative cache on every pod so a
      // shipper using it immediately is not shadowed by a miss ("minted" maps to
      // a `clearNegative`, a safe no-op even if the instance starts disabled).
      if (pushTokenHash) {
        await emitPushTokenInvalidated({
          sourceTypeId: input.sourceTypeId,
          sourceId: id,
          tokenHash: pushTokenHash,
          reason: "minted",
        });
      }
      notifySatellites([satelliteId]);
      const [enriched] = await enrichBindingStreamNames({
        sources: [mapRow(row)],
        sinkRegistry,
        logger,
      });
      return {
        ...enriched!,
        ...(webhook ? { webhook } : {}),
        ...(push ? { push } : {}),
      };
    },

    async updateSource({ id, body, user, requestHeaders }) {
      const existing = await loadRowOrThrow(id);
      const type = requireType(existing.sourceTypeId);

      if (body.bindings) {
        assertSignalsSubset({ type, bindings: body.bindings });
        await assertBindingsAuthorized({
          bindings: body.bindings,
          sinkRegistry,
          user,
        });
      }

      // Config: replace, but keep omitted secrets and clear explicit-null ones.
      let nextConfig = existing.config;
      if (body.config) {
        const secretFields = listSecretFields(type.configSchema);
        const { configToStore, toStore, toClear } = partitionSecretsForWrite({
          incomingConfig: body.config,
          storedConfig: existing.config,
          secretFields,
          sourceId: id,
        });
        nextConfig = parseConfig({ type, config: configToStore });
        await secretStore.apply({ sourceId: id, toStore, toClear });
      }

      const intervalSeconds =
        body.intervalSeconds === undefined
          ? existing.intervalSeconds
          : resolveInterval({ type, requested: body.intervalSeconds });

      const satelliteId =
        body.satelliteId === undefined
          ? existing.satelliteId
          : body.satelliteId;
      assertSatelliteAllowed({ type, satelliteId });
      // SSRF-pivot guard: only when the caller is SETTING a non-null satelliteId
      // (bind or rebind). Runs BEFORE any persistence.
      if (typeof body.satelliteId === "string") {
        await assertSatelliteBindable({
          satelliteId: body.satelliteId,
          requestHeaders,
        });
      }

      const [row] = await db
        .update(telemetrySources)
        .set({
          name: body.name ?? existing.name,
          description:
            body.description === undefined
              ? existing.description
              : body.description,
          config: nextConfig,
          bindings: body.bindings ?? existing.bindings,
          enabled: body.enabled ?? existing.enabled,
          intervalSeconds,
          satelliteId,
          updatedAt: now(),
        })
        .where(eq(telemetrySources.id, id))
        .returning();
      if (!row) {
        throw new ORPCError("NOT_FOUND", { message: "Source not found" });
      }

      await reconcile.scheduleSource({ sourceId: id });
      await broadcastChanged(id, "updated");
      // Push-token cache coherence for the CURRENT hash. Two independent causes,
      // both eviction-driven (a cached ingest verdict embeds the bound streamId):
      //   - BINDINGS changed (re-bind stream A->B, fix empty bindings): the warm
      //     verdict now routes to the wrong stream, so "revoked" evicts it and
      //     the next request re-resolves + re-caches against the new binding.
      //   - ENABLED flipped: "revoked" on disable (drop the positive verdict),
      //     "minted" on re-enable (clear the negative cache).
      // Emit at most one of each reason; a simultaneous rebind + re-enable emits
      // both (evict the stale verdict AND clear the negative cache).
      if (existing.pushTokenHash) {
        const enabledChanged =
          body.enabled !== undefined && body.enabled !== existing.enabled;
        const bindingsChanged =
          body.bindings !== undefined &&
          !sourceBindingsEqual(existing.bindings, body.bindings);
        const shouldRevoke =
          bindingsChanged || (enabledChanged && body.enabled === false);
        const shouldMint = enabledChanged && body.enabled === true;
        if (shouldRevoke) {
          await emitPushTokenInvalidated({
            sourceTypeId: existing.sourceTypeId,
            sourceId: id,
            tokenHash: existing.pushTokenHash,
            reason: "revoked",
          });
        }
        if (shouldMint) {
          await emitPushTokenInvalidated({
            sourceTypeId: existing.sourceTypeId,
            sourceId: id,
            tokenHash: existing.pushTokenHash,
            reason: "minted",
          });
        }
      }
      // Re-push to BOTH the old and new satellite on a move (either may be null).
      notifySatellites([existing.satelliteId, satelliteId]);
      const [enriched] = await enrichBindingStreamNames({
        sources: [mapRow(row)],
        sinkRegistry,
        logger,
      });
      return enriched!;
    },

    async deleteSource({ id }) {
      await purgeSource(await loadRowOrThrow(id));
    },

    async handleStreamDeleted({ signal, streamId }) {
      // Every source carrying a binding for exactly this {signal, streamId}.
      // jsonb containment (`@>`) is an indexable, set-based match, so a stream
      // with no bound sources costs one empty query (idempotent no-op).
      const rows = await db
        .select()
        .from(telemetrySources)
        .where(
          sql`${telemetrySources.bindings} @> ${JSON.stringify([
            { signal, streamId },
          ])}::jsonb`,
        );
      for (const existing of rows) {
        const remaining = existing.bindings.filter(
          (b) => !(b.signal === signal && b.streamId === streamId),
        );
        // Defensive: containment matched but nothing was actually stripped.
        if (remaining.length === existing.bindings.length) continue;
        // No bindings left -> the source can never route again, so fully purge
        // it; otherwise persist the reduced set and evict its cached verdict.
        await (remaining.length === 0
          ? purgeSource(existing)
          : unbindAndPersist(existing, remaining));
      }
    },

    async getSource({ id }) {
      const [enriched] = await enrichBindingStreamNames({
        sources: [mapRow(await loadRowOrThrow(id))],
        sinkRegistry,
        logger,
      });
      return enriched!;
    },

    async listSources(input) {
      const rows = await db
        .select()
        .from(telemetrySources)
        .where(
          input?.sourceTypeId
            ? eq(telemetrySources.sourceTypeId, input.sourceTypeId)
            : undefined,
        )
        .orderBy(desc(telemetrySources.createdAt));

      const filtered = rows
        .map((row) => mapRow(row))
        .filter((source) => matchesBindingFilter({ source, input }));
      // ONE describeStreams call per signal across the WHOLE filtered set.
      const sources = await enrichBindingStreamNames({
        sources: filtered,
        sinkRegistry,
        logger,
      });
      return { sources };
    },

    async listSatelliteSources({ satelliteId }) {
      const rows = await db
        .select()
        .from(telemetrySources)
        .where(
          and(
            eq(telemetrySources.satelliteId, satelliteId),
            eq(telemetrySources.enabled, true),
          ),
        )
        .orderBy(desc(telemetrySources.createdAt));
      return { sources: rows.map((row) => mapRow(row)) };
    },

    async listBindableStreams({ signal, user }) {
      return resolveBindableStreams({ sinkRegistry, signal, user, logger });
    },

    async rotateWebhookSecret({ id }) {
      const existing = await loadRowOrThrow(id);
      const type = requireType(existing.sourceTypeId);
      if (!type.webhook) {
        throw new ORPCError("BAD_REQUEST", {
          message: "This source type has no webhook endpoint",
        });
      }
      const generated = webhookKit.generateToken({ resourceId: id });
      await db
        .update(telemetrySources)
        .set({
          webhookSecretHash: generated.tokenHash,
          webhookSecretPrefix: generated.tokenPrefix,
          updatedAt: now(),
        })
        .where(eq(telemetrySources.id, id));
      // Rotate the encrypted HMAC key too, so signatures minted from the old
      // secret stop verifying (signature-verifying types only).
      if (type.webhook.signature) {
        await secretStore.setWebhookSecret({ sourceId: id, secret: generated.secret });
      }
      await broadcastChanged(id, "updated");
      return { path: webhookPath(id), secret: generated.secret };
    },

    async rotatePushToken({ id }) {
      const existing = await loadRowOrThrow(id);
      const type = requireType(existing.sourceTypeId);
      if (!type.push) {
        throw new ORPCError("BAD_REQUEST", {
          message: "This source type has no push endpoint",
        });
      }
      const oldHash = existing.pushTokenHash;
      const generated = pushKitFor(type.push.tokenPrefix).generateToken({
        resourceId: id,
      });
      await db
        .update(telemetrySources)
        .set({
          pushTokenHash: generated.tokenHash,
          pushTokenPrefix: generated.tokenPrefix,
          updatedAt: now(),
        })
        .where(eq(telemetrySources.id, id));
      // Revoke the OLD hash first (consumers evict its positive verdict + miss
      // marker), then mint the NEW one (consumers clear the negative cache).
      // This does NOT make the old token stop verifying instantly: warm pods
      // keep serving it until the best-effort "revoked" event lands, and if that
      // event is dropped, until its 60s positive-cache TTL expires - so the
      // guarantee is TTL-bounded convergence, not an atomic cutover.
      if (oldHash) {
        await emitPushTokenInvalidated({
          sourceTypeId: existing.sourceTypeId,
          sourceId: id,
          tokenHash: oldHash,
          reason: "revoked",
        });
      }
      await emitPushTokenInvalidated({
        sourceTypeId: existing.sourceTypeId,
        sourceId: id,
        tokenHash: generated.tokenHash,
        reason: "minted",
      });
      await broadcastChanged(id, "updated");
      return { token: generated.secret, endpoints: type.push.endpoints };
    },

    async resolveRunnableConfig({ sourceId, sourceTypeId, config }) {
      const type = requireType(sourceTypeId);
      return resolveRunnableConfig({ type, config, sourceId, secretStore });
    },

    async runConfigTest({ sourceTypeId, config, sourceId }) {
      const type = sourceRegistry.get(sourceTypeId);
      if (!type) {
        return { supported: false, ok: false, message: "Unknown source type" };
      }
      if (!type.pull) {
        return {
          supported: false,
          ok: false,
          message: "This source type has no pull connection test",
        };
      }

      // A cleared secret arrives as the SECRET_CLEAR_SENTINEL (the frontend's
      // "clear this field" signal). Drop those entries and remember them so a
      // cleared secret behaves as ABSENT: it never leaks the sentinel string
      // into the executed config, AND it is NOT refilled from the stored secret
      // below. The result is a required secret failing validation cleanly, an
      // optional one simply gone - exactly as if the caller had no value.
      const clearedSecretFields = new Set<string>();
      const effectiveConfig: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(config)) {
        if (isSecretClearSentinel(value)) {
          clearedSecretFields.add(key);
          continue;
        }
        effectiveConfig[key] = value;
      }
      // Merge stored secrets ONLY for omitted keys when testing an existing
      // source (the caller's manage grant on it is verified in the router).
      // Fields the caller explicitly cleared are excluded from resolution, so
      // their stored secret is neither pulled from the store nor merged back in.
      if (sourceId) {
        const [row] = await db
          .select({ config: telemetrySources.config })
          .from(telemetrySources)
          .where(eq(telemetrySources.id, sourceId))
          .limit(1);
        if (row) {
          const storedForMerge: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(row.config)) {
            if (!clearedSecretFields.has(key)) storedForMerge[key] = value;
          }
          const resolvedStored = await secretStore.resolve({
            config: storedForMerge,
            sourceId,
          });
          for (const [key, value] of Object.entries(resolvedStored)) {
            if (effectiveConfig[key] === undefined) {
              effectiveConfig[key] = value;
            }
          }
        }
      }

      let parsedConfig: unknown;
      try {
        parsedConfig = type.configSchema.parse(effectiveConfig);
      } catch (error) {
        return { supported: true, ok: false, message: safeMessage(error) };
      }

      const { sink, getCounts } = createCountingSink({ signals: type.signals });
      const fetchImpl = createGuardedFetch({
        logger,
        ...(lookupFn === undefined ? {} : { lookupFn }),
      });
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        CONFIG_TEST_TIMEOUT_MS,
      );
      try {
        await type.pull.execute({
          config: parsedConfig,
          sink,
          fetch: fetchImpl,
          logger,
          abortSignal: controller.signal,
        });
        const counts = getCounts();
        // The contract's `recordCounts` is a full per-signal record; fill
        // unemitted signals with 0 (no cast).
        const recordCounts: Record<TelemetrySignal, number> = {
          logs: counts.logs ?? 0,
          metrics: counts.metrics ?? 0,
          traces: counts.traces ?? 0,
        };
        return { supported: true, ok: true, recordCounts };
      } catch (error) {
        const message = controller.signal.aborted
          ? `Connection test timed out after ${CONFIG_TEST_TIMEOUT_MS}ms`
          : safeMessage(error);
        return { supported: true, ok: false, message };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// =============================================================================
// MAPPING + HELPERS
// =============================================================================

/** Validate + resolve an interval override against the type. */
function resolveInterval({
  type,
  requested,
}: {
  type: RegisteredTelemetrySourceType;
  requested: number | null | undefined;
}): number | null {
  if (requested == null) return null;
  if (!type.pull) {
    throw new ORPCError("BAD_REQUEST", {
      message: "intervalSeconds is not valid for a webhook-only source type",
    });
  }
  return clampInterval({
    requested,
    defaultSeconds: type.pull.defaultIntervalSeconds,
    minSeconds: type.pull.minIntervalSeconds,
  });
}

/** Reject a satellite binding on a type that does not support satellites. */
function assertSatelliteAllowed({
  type,
  satelliteId,
}: {
  type: RegisteredTelemetrySourceType;
  satelliteId: string | null | undefined;
}): void {
  if (satelliteId && !type.supportsSatellite) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This source type does not support satellite execution",
    });
  }
}

/** Parse a config against the type's schema; markers survive as strings. */
function parseConfig({
  type,
  config,
}: {
  type: RegisteredTelemetrySourceType;
  config: Record<string, unknown>;
}): Record<string, unknown> {
  const result = type.configSchema.safeParse(config);
  if (!result.success) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Invalid source config: ${result.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`,
    });
  }
  // `Config` is generic-erased to `unknown` on a registered type, but a source
  // config is always a JSON object persisted to the jsonb column; narrow it for
  // storage. (Unavoidable cast: the registry stores config schemas signal- and
  // config-erased.)
  return result.data as Record<string, unknown>;
}

/**
 * Resolve a stored config's secret markers to plaintext and parse it against
 * the type's schema, yielding the typed config a seam executes with. Module-
 * level so the pull runner, listener manager, and satellite pull-capability
 * handler all reuse ONE resolution path (no closure buried in setup).
 */
export async function resolveRunnableConfig({
  type,
  config,
  sourceId,
  secretStore,
}: {
  type: RegisteredTelemetrySourceType;
  config: Record<string, unknown>;
  sourceId: string;
  secretStore: SourceSecretStore;
}): Promise<unknown> {
  const resolved = await secretStore.resolve({ config, sourceId });
  return parseConfig({ type, config: resolved });
}

/**
 * Resolve the streams a caller may bind for a signal, delegating to the owning
 * sink's OPTIONAL `listBindableStreams` (which filters by the plugin's own
 * access rules). Returns an empty list when the caller is unauthenticated, no
 * sink owns the signal, or the sink has not adopted the lister yet - so the
 * binding picker degrades to empty rather than erroring. Module-level and
 * exported so it is unit-testable without the full service.
 */
export async function resolveBindableStreams({
  sinkRegistry,
  signal,
  user,
  logger,
}: {
  sinkRegistry: TelemetrySinkRegistry;
  signal: TelemetrySignal;
  user: AuthUser | undefined;
  logger: Logger;
}): Promise<{ streams: BindableStream[] }> {
  if (!user) return { streams: [] };
  const sink = sinkRegistry.get(signal);
  if (!sink?.listBindableStreams) {
    logger.debug(
      `telemetry: no bindable-stream lister for signal "${signal}" (no sink or sink has not adopted it)`,
    );
    return { streams: [] };
  }
  const streams = await sink.listBindableStreams({ user });
  return { streams };
}

/**
 * Resolve the display name of every bound stream across a WHOLE result set and
 * distribute the names back onto each source's `bindingStreamNames` (keyed by
 * signal). Batched by design: it collects all bound stream ids PER SIGNAL over
 * every source, then makes ONE `describeStreams` call per signal (never a
 * per-row lookup), so a 200-source list costs one query per signal, not 200.
 *
 * A sink that has not adopted the batched `describeStreams` falls back to its
 * per-id `describeStream` - still grouped per signal, run concurrently. A signal
 * with no registered sink (owning plugin not installed) or a stream that no
 * longer resolves (deleted) yields a null name. Module-level and exported so it
 * is unit-testable without the full service.
 */
export async function enrichBindingStreamNames({
  sources,
  sinkRegistry,
  logger,
}: {
  sources: TelemetrySource[];
  sinkRegistry: TelemetrySinkRegistry;
  logger: Logger;
}): Promise<TelemetrySource[]> {
  if (sources.length === 0) return sources;

  // Collect the distinct bound stream ids per signal across ALL sources.
  const idsBySignal = new Map<TelemetrySignal, Set<string>>();
  for (const source of sources) {
    for (const binding of source.bindings) {
      let ids = idsBySignal.get(binding.signal);
      if (!ids) {
        ids = new Set<string>();
        idsBySignal.set(binding.signal, ids);
      }
      ids.add(binding.streamId);
    }
  }

  // Resolve names per signal in ONE batched call each (or a per-id fallback).
  const namesBySignal = new Map<TelemetrySignal, Map<string, string | null>>();
  for (const [signal, idSet] of idsBySignal) {
    const streamIds = [...idSet];
    const names = new Map<string, string | null>();
    const sink = sinkRegistry.get(signal);
    if (!sink) {
      // No sink owns this signal (owning plugin not installed) - names unknown.
      for (const id of streamIds) names.set(id, null);
    } else if (sink.describeStreams) {
      const batch = await sink.describeStreams({ streamIds });
      for (const id of streamIds) names.set(id, batch[id]?.name ?? null);
    } else {
      // Fallback for a sink without the batched method: per-id describeStream,
      // still grouped per signal and run concurrently (never per-row).
      logger.debug(
        `telemetry: sink for signal "${signal}" has no describeStreams; falling back to per-id describeStream`,
      );
      const resolved = await Promise.all(
        streamIds.map((id) => sink.describeStream({ streamId: id })),
      );
      for (const [index, id] of streamIds.entries()) {
        names.set(id, resolved[index]?.name ?? null);
      }
    }
    namesBySignal.set(signal, names);
  }

  // Distribute the resolved names back onto each source.
  return sources.map((source) => {
    const bindingStreamNames: Partial<Record<TelemetrySignal, string | null>> =
      {};
    for (const binding of source.bindings) {
      bindingStreamNames[binding.signal] =
        namesBySignal.get(binding.signal)?.get(binding.streamId) ?? null;
    }
    return { ...source, bindingStreamNames };
  });
}

// =============================================================================
// SATELLITE SEAMS (module-level, for the telemetry-pull capability handler)
// =============================================================================

/**
 * Load one raw source row (config carries markers - resolve via
 * {@link resolveRunnableConfig} / `SourceSecretStore`). For the satellite pull
 * capability handler, which runs server-side and needs the unstripped row.
 */
export async function loadSourceRow({
  db,
  id,
}: {
  db: Db;
  id: string;
}): Promise<TelemetrySourceRow | null> {
  const [row] = await db
    .select()
    .from(telemetrySources)
    .where(eq(telemetrySources.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * Enabled instances bound to a satellite, as RAW rows (markers intact). The
 * capability handler pushes each down and resolves secrets JIT per field.
 */
export async function listSatelliteBoundSourceRows({
  db,
  satelliteId,
}: {
  db: Db;
  satelliteId: string;
}): Promise<TelemetrySourceRow[]> {
  return db
    .select()
    .from(telemetrySources)
    .where(
      and(
        eq(telemetrySources.satelliteId, satelliteId),
        eq(telemetrySources.enabled, true),
      ),
    )
    .orderBy(desc(telemetrySources.createdAt));
}

/** Map a row to the read DTO, stripping secret markers. */
export function mapRow(row: TelemetrySourceRow): TelemetrySource {
  const { config, storedSecretFields } = stripSecretsForRead({
    storedConfig: row.config,
    sourceId: row.id,
  });
  return {
    id: row.id,
    sourceTypeId: row.sourceTypeId,
    name: row.name,
    description: row.description,
    config,
    storedSecretFields,
    bindings: row.bindings,
    // Populated by `enrichBindingStreamNames` on read paths; empty for machine
    // paths that never display bound stream names.
    bindingStreamNames: {},
    enabled: row.enabled,
    intervalSeconds: row.intervalSeconds,
    satelliteId: row.satelliteId,
    lastRunAt: row.lastRunAt,
    lastError: row.lastError,
    consecutiveFailures: row.consecutiveFailures,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Order-independent equality of two binding sets (at most one binding per
 * signal, so a `signal streamId` key set comparison is exact). Used to
 * detect a binding change on update so the push-token verdict is evicted.
 */
export function sourceBindingsEqual(
  a: SourceBinding[],
  b: SourceBinding[],
): boolean {
  if (a.length !== b.length) return false;
  const key = (list: SourceBinding[]) =>
    list
      .map((x) => `${x.signal} ${x.streamId}`)
      .toSorted()
      .join("|");
  return key(a) === key(b);
}

function matchesBindingFilter({
  source,
  input,
}: {
  source: TelemetrySource;
  input?: { streamId?: string; signal?: TelemetrySignal };
}): boolean {
  const { streamId, signal } = input ?? {};
  if (streamId && !source.bindings.some((b) => b.streamId === streamId)) {
    return false;
  }
  if (signal && !source.bindings.some((b) => b.signal === signal)) {
    return false;
  }
  return true;
}

/** A user-safe message for a failed config test (never echoes config/secrets). */
function safeMessage(error: unknown): string {
  // The message is the source/guard's own text (e.g. "connection refused",
  // "scheme not allowed"); it never contains config values.
  const message = extractErrorMessage(error);
  return message.length > 0 ? message : "Connection test failed";
}
