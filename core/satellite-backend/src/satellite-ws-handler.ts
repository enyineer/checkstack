import type { Logger } from "@checkstack/backend-api";
import type {
  WebSocketRouteHandler,
  WsConnection,
  WsConnectionHandlers,
} from "@checkstack/backend-api";
import { extractErrorMessage } from "@checkstack/common";
import type { SatelliteService } from "./service";
import type { ConfigRelay } from "./config-relay";
import type { SatelliteConnectionEvent } from "./entity";
import {
  SatelliteToCoreMessageSchema,
  TELEMETRY_DEDUPE_WINDOW,
  TELEMETRY_BUDGET_BYTES_PER_MIN,
  type CoreToSatelliteMessage,
  type ResultMessage,
  type SatelliteWithStatus,
  type TelemetryBatchMessage,
  type CapabilityStatusMessage,
  type CapabilitySecretRequestMessage,
} from "@checkstack/satellite-common";
import type { SandboxPolicy } from "@checkstack/common";
import type {
  SatelliteCapabilityHandler,
  SatelliteCapabilityRouter,
} from "./capability-registry";

/**
 * Optional plug-point for driving a satellite connection lifecycle edge into
 * the reactive `satellite-connection` entity (reactive automation engine
 * §10.6). Bound from `afterPluginsReady` where the entity handle is available —
 * when not provided, no entity state is mirrored (graceful no-op in unit tests).
 *
 * The WS handler calls `mirror` at the same connect / disconnect lifecycle
 * points it previously emitted the `satellite.connected` / `.disconnected`
 * hooks; the change-deriver re-fires the equivalent trigger events. The status
 * is COMPUTED on read from `lastHeartbeatAt`, so the sink carries the new
 * heartbeat value for the edge rather than a status: `now` on connect (online),
 * `null` on clean disconnect (offline immediately).
 */
export interface SatelliteConnectionEntitySink {
  mirror: (input: {
    satelliteId: string;
    lastEvent: SatelliteConnectionEvent;
    lastHeartbeatAt: Date | null;
  }) => Promise<void>;
}

/**
 * Callback for handling health check results received from satellites.
 */
export interface SatelliteResultHandler {
  handleResult(props: {
    satelliteId: string;
    sourceLabel: string;
    result: ResultMessage;
  }): Promise<void>;
}

/**
 * Optional plug-point for script-package distribution to satellites. Wired
 * from `afterPluginsReady` against the script-packages RPC. When absent,
 * satellites simply never receive a `scriptPackagesLockfileHash` or refresh
 * push (graceful no-op on installs without the plugin).
 */
export interface SatelliteScriptPackageSink {
  /** The desired lockfile hash to carry in assignment payloads, or null. */
  getDesiredLockfileHash(): Promise<string | null>;
  /** Persist a satellite's reconcile state for the admin UI. */
  reportSyncState(input: {
    satelliteId: string;
    lockfileHash: string | null;
    status: "pending" | "syncing" | "ready" | "error";
    errorMessage?: string;
  }): Promise<void>;
  /** Manifest entries for a lockfile hash (for satellite delta diffing). */
  getManifest(input: {
    lockfileHash: string;
  }): Promise<{ name: string; version: string; integrity: string }[]>;
  /** One content-addressed blob as base64, or null if not found. */
  getBlobBase64(input: { integrity: string }): Promise<string | null>;
}

/**
 * Optional plug-point for just-in-time secret delivery to satellites.
 * Wired from `afterPluginsReady` against `secretResolverRef`. When absent,
 * a `request_run_secrets` is answered with an error (no secrets available),
 * so a collector that declares `secretEnv` fails clearly rather than
 * running without it.
 *
 * The resolver reads the declared `secretEnv` from the satellite's persisted
 * assignment (the satellite does not choose which secrets), resolves ONLY
 * those refs, and returns the env map. Resolved values are never persisted.
 */
export interface SatelliteSecretSink {
  resolveRunSecrets(input: {
    satelliteId: string;
    configId: string;
    collectorId: string;
  }): Promise<Record<string, string>>;
  /**
   * Resolve an assignment's CONFIG secrets (`x-secret` strategy/collector
   * config fields holding internal markers or `${{ secrets.* }}`
   * references) to `fieldPath -> value` maps. Same least-privilege model:
   * core reads the satellite's own persisted assignment. Optional for
   * version-skew safety - an older core build simply lacks the method and
   * the handler replies with an error.
   */
  resolveConfigSecrets?(input: {
    satelliteId: string;
    configId: string;
  }): Promise<{
    strategy: Record<string, string>;
    collectors: Record<string, Record<string, string>>;
  }>;
}

/**
 * Optional plug-point for relaying the GLOBAL script-sandbox policy to
 * satellites. Wired from `afterPluginsReady` against the script-packages RPC.
 * When absent, the `authenticated` message omits `sandboxPolicy` (version-skew
 * safe) and the satellite stays FAIL-CLOSED until a policy arrives, so a
 * missing sink can never loosen a satellite's sandbox.
 */
export interface SatelliteSandboxPolicySink {
  /** The current resolved global sandbox policy to relay to satellites. */
  getCurrentPolicy(): Promise<SandboxPolicy>;
}

/**
 * Active satellite connection tracking.
 *
 * `allowedResults` is a per-connection cache of the (configId, systemId) pairs
 * the satellite is actually assigned. It authorizes inbound `result` messages
 * (a satellite may only report for what it is assigned), is seeded on connect
 * and refreshed on every `pushConfigUpdate`, and is pod-local transport
 * bookkeeping (`declareNonReactiveState`): the authoritative assignment set
 * lives in the durable healthcheck tables and is re-read on each push. The key
 * is `configId\u0000systemId` (NUL separator can't occur in an id).
 */
/**
 * A telemetry dedupe-window entry: `processing` while the handler is in flight
 * (a racing resend is dropped), `done` once a TERMINAL outcome is known (a later
 * resend is re-acked with these counts).
 */
type TelemetryDedupeEntry =
  | { status: "processing" }
  | { status: "done"; accepted: number; rejected: number };

interface SatelliteConnection {
  satellite: SatelliteWithStatus;
  ws: WsConnection;
  allowedResults: Set<string>;
  /**
   * Per-connection telemetry batchId dedupe window. An entry is created at
   * RECEIVE time as `{ status: "processing" }` BEFORE the handler is awaited, so
   * a resend that races a still-in-flight batch is dropped instead of
   * re-processed (the handlers are NOT idempotent). When the handler settles the
   * entry becomes `{ status: "done", accepted, rejected }` for a TERMINAL
   * outcome (a later resend is idempotently re-acked with the same counts), or is
   * DELETED for a transient/retryable outcome (so a legitimate resend
   * re-processes). Bounded to {@link TELEMETRY_DEDUPE_WINDOW} `done` entries
   * (oldest evicted). Pod-local transport bookkeeping, never a source of truth.
   */
  telemetryDedupe: Map<string, TelemetryDedupeEntry>;
  /** Start (ms epoch) of the current per-connection telemetry budget minute. */
  telemetryBudgetWindowStart: number;
  /** Bytes of telemetry ingested in the current budget minute. */
  telemetryBudgetBytesUsed: number;
}

/** Build the per-connection authorization key for a (configId, systemId). */
function resultAuthKey(configId: string, systemId: string): string {
  return `${configId}\u0000${systemId}`;
}

/** Derive the allowed (configId, systemId) set from a satellite's assignments. */
function buildAllowedResults(
  assignments: ReadonlyArray<{ configId: string; systemId: string }>,
): Set<string> {
  return new Set(
    assignments.map((a) => resultAuthKey(a.configId, a.systemId)),
  );
}

/**
 * WebSocket handler for satellite connections.
 * Manages authentication, heartbeats, result ingestion, and config pushes.
 */
export class SatelliteWsHandler implements WebSocketRouteHandler {
  /**
   * Pod-local live-socket registry: satelliteId → the WebSocket connection
   * physically held by THIS pod. This is NOT the reactive entity's source of
   * truth (that is the durable `satellites` connection columns, globally
   * readable from any pod). It exists ONLY to route messages — config pushes,
   * script-package refreshes, shutdowns — to a socket this pod actually owns;
   * a satellite connected to another pod is simply absent here. Treat it as
   * transport infrastructure, not state.
   */
  private connections = new Map<string, SatelliteConnection>();

  constructor(
    private service: SatelliteService,
    private configRelay: ConfigRelay,
    private resultHandler: SatelliteResultHandler,
    private logger: Logger,
    /**
     * Optional. When set, the handler mirrors `online` / `offline`
     * connection state into the reactive `satellite-connection` entity at
     * the same lifecycle points it logs. Wired by `afterPluginsReady` so the
     * action graph stays decoupled from entity-handle availability.
     */
    private connectionEntitySink?: SatelliteConnectionEntitySink,
    /**
     * Optional. When set, assignment payloads carry the desired script-package
     * lockfile hash and the handler can push `refresh_script_packages` +
     * persist per-satellite sync state.
     */
    private scriptPackageSink?: SatelliteScriptPackageSink,
    /**
     * Optional. When set, the handler answers `request_run_secrets` by
     * resolving the collector's declared secretEnv just-in-time. When
     * unset, such a request is answered with an error.
     */
    private secretSink?: SatelliteSecretSink,
    /**
     * Optional. When set, the `authenticated` message carries the resolved
     * global sandbox policy and the handler can push `sandbox_policy` on change.
     * When unset, the field is omitted and the satellite stays fail-closed.
     */
    private sandboxPolicySink?: SatelliteSandboxPolicySink,
    /**
     * Optional. Routes inbound `telemetry_batch` / `capability_status` envelopes
     * to the registered capability handler for their `kind`, and builds the
     * `capability_config` pushed on connect / on change. When unset, telemetry
     * batches are answered with a non-retryable ack (no handler) and status
     * updates are dropped - the health-result path is unaffected either way.
     */
    private capabilityRouter?: SatelliteCapabilityRouter,
  ) {}

  /**
   * Handle a new WebSocket connection (pre-authentication).
   * The satellite must send an `authenticate` message as its first message.
   * Implements WebSocketRouteHandler.onConnection.
   */
  onConnection(ws: WsConnection): WsConnectionHandlers {
    let authenticatedSatellite: SatelliteWithStatus | undefined;

    const onMessage = async (message: string) => {
      let parsed: ReturnType<typeof SatelliteToCoreMessageSchema.parse>;
      try {
        parsed = SatelliteToCoreMessageSchema.parse(JSON.parse(message));
      } catch {
        this.logger.warn("Invalid satellite message received");
        return;
      }

      // Pre-authentication: only accept `authenticate`
      if (!authenticatedSatellite) {
        if (parsed.type !== "authenticate") {
          this.sendMessage(ws, {
            type: "auth_failed",
            reason: "Must authenticate first",
          });
          ws.close();
          return;
        }

        const satellite = await this.service.validateToken({
          clientId: parsed.clientId,
          token: parsed.token,
        });

        if (!satellite) {
          this.sendMessage(ws, {
            type: "auth_failed",
            reason: "Invalid client ID or token",
          });
          ws.close();
          return;
        }

        authenticatedSatellite = satellite;

        // Fetch the authoritative assignment set up-front: it both feeds the
        // `authenticated` payload below AND seeds the per-connection result
        // authorization cache (a satellite may only report for what it is
        // assigned). One read, used twice.
        const assignments =
          await this.configRelay.getAssignmentsForSatellite(satellite.id);

        // Track connection (with the seeded result-authorization cache and
        // fresh telemetry dedupe/budget state).
        this.connections.set(satellite.id, {
          satellite,
          ws,
          allowedResults: buildAllowedResults(assignments),
          telemetryDedupe: new Map(),
          telemetryBudgetWindowStart: Date.now(),
          telemetryBudgetBytesUsed: 0,
        });

        // Persist advertised capabilities (best-effort - never block auth on it)
        // so the read model / UI reflect what this satellite can do.
        if (parsed.capabilities !== undefined) {
          try {
            await this.service.updateCapabilities(
              satellite.id,
              parsed.capabilities,
            );
          } catch (error) {
            this.logger.error(
              `Failed to persist capabilities for ${satellite.name}:`,
              error,
            );
          }
        }

        // Drive the `connected` edge into the reactive entity (best-effort —
        // never block the auth handshake on a mirror failure). `apply` sets
        // `lastHeartbeatAt = now` so the computed status reads `online`, and
        // `lastConnectionEvent = "connected"`; the change-deriver re-fires the
        // `satellite.connected` trigger event. This is also the connect-time
        // heartbeat write (no separate `updateHeartbeat` needed), and it runs
        // through `handle.mutate` so `prev` is snapshotted BEFORE the write.
        if (this.connectionEntitySink) {
          try {
            await this.connectionEntitySink.mirror({
              satelliteId: satellite.id,
              lastEvent: "connected",
              lastHeartbeatAt: new Date(),
            });
          } catch (error) {
            this.logger.error(
              `Failed to mirror satellite-connection (connected) for ${satellite.name}:`,
              error,
            );
          }
        } else {
          // No entity sink wired (e.g. unit tests): still record the
          // connect-time heartbeat directly so liveness is correct.
          await this.service.updateHeartbeat(satellite.id, {});
        }

        // Send authenticated response with full config. Carry the desired
        // script-package lockfile hash as the durable convergence backstop:
        // a satellite that missed a refresh push reconciles on connect.
        const scriptPackagesLockfileHash =
          await this.resolveDesiredLockfileHash();
        const sandboxPolicy = await this.resolveSandboxPolicy();

        this.sendMessage(ws, {
          type: "authenticated",
          satelliteId: satellite.id,
          assignments,
          ...(scriptPackagesLockfileHash === undefined
            ? {}
            : { scriptPackagesLockfileHash }),
          ...(sandboxPolicy === undefined ? {} : { sandboxPolicy }),
        });

        this.logger.info(
          `Satellite authenticated: ${satellite.name} (${satellite.region})`,
        );

        // Push each capability's initial config right after `authenticated`
        // (e.g. the scrape targets bound to this satellite). Best-effort; a
        // build failure for one kind never blocks the others or the handshake.
        await this.pushAllCapabilityConfigs(satellite.id);
        return;
      }

      // Post-authentication: handle all message types
      switch (parsed.type) {
        case "heartbeat": {
          await this.service.updateHeartbeat(authenticatedSatellite.id, {
            version: parsed.version,
          });
          // Re-advertised capabilities converge without a reconnect.
          if (parsed.capabilities !== undefined) {
            await this.service.updateCapabilities(
              authenticatedSatellite.id,
              parsed.capabilities,
            );
          }
          break;
        }
        case "telemetry_batch": {
          await this.handleTelemetryBatch(authenticatedSatellite, parsed, message);
          break;
        }
        case "capability_status": {
          await this.handleCapabilityStatus(authenticatedSatellite, parsed);
          break;
        }
        case "capability_secret_request": {
          await this.handleCapabilitySecretRequest(
            authenticatedSatellite,
            parsed,
          );
          break;
        }
        case "result": {
          // AUTHORIZATION (not just authentication): a satellite may only
          // report results for (configId, systemId) pairs it is actually
          // assigned. The handshake proves WHICH satellite this is; this check
          // proves WHAT it may report for. Without it, a compromised satellite
          // could forge health data for any system (suppress a real outage,
          // raise false alarms, inject payloads into charts/aggregates).
          //
          // Reject = log + DROP the single message (do NOT close the socket):
          // a stale cache after a just-applied reassignment is corrected by the
          // `config_updated` push, and we must never tear down a connection
          // (and its legitimate results) over one unauthorized message.
          const conn = this.connections.get(authenticatedSatellite.id);
          const authKey = resultAuthKey(parsed.configId, parsed.systemId);
          if (!conn || !conn.allowedResults.has(authKey)) {
            this.logger.warn(
              `Satellite ${authenticatedSatellite.name} (${authenticatedSatellite.region}) ` +
                `reported a result for unassigned config=${parsed.configId} ` +
                `system=${parsed.systemId}; dropping (not in its assignment set)`,
            );
            break;
          }
          await this.resultHandler.handleResult({
            satelliteId: authenticatedSatellite.id,
            sourceLabel: `${authenticatedSatellite.name} (${authenticatedSatellite.region})`,
            result: parsed,
          });
          break;
        }
        case "strategy_error": {
          this.logger.warn(
            `Satellite ${authenticatedSatellite.name} reports strategy error: ${parsed.strategyId} - ${parsed.message}`,
          );
          break;
        }
        case "script_package_sync_state": {
          // Persist the satellite's reconcile state for the admin UI.
          try {
            await this.scriptPackageSink?.reportSyncState({
              satelliteId: authenticatedSatellite.id,
              lockfileHash: parsed.lockfileHash,
              status: parsed.status,
              errorMessage: parsed.errorMessage,
            });
          } catch (error) {
            this.logger.error(
              `Failed to persist script-package sync state for ${authenticatedSatellite.name}:`,
              error,
            );
          }
          break;
        }
        case "request_script_package_manifest": {
          const entries =
            (await this.scriptPackageSink?.getManifest({
              lockfileHash: parsed.lockfileHash,
            })) ?? [];
          this.sendMessage(ws, {
            type: "script_package_manifest",
            lockfileHash: parsed.lockfileHash,
            entries,
          });
          break;
        }
        case "request_script_package_blob": {
          const data =
            (await this.scriptPackageSink?.getBlobBase64({
              integrity: parsed.integrity,
            })) ?? null;
          this.sendMessage(ws, {
            type: "script_package_blob",
            integrity: parsed.integrity,
            data,
          });
          break;
        }
        case "request_run_secrets": {
          // JIT secret delivery: resolve ONLY the collector's declared
          // secretEnv (read from the persisted assignment, not chosen by
          // the satellite) and reply with the env map. On any failure,
          // reply with an error so the satellite fails the run clearly.
          if (!this.secretSink) {
            this.sendMessage(ws, {
              type: "run_secrets",
              requestId: parsed.requestId,
              error: "Secret delivery is not available on this core instance.",
            });
            break;
          }
          try {
            const env = await this.secretSink.resolveRunSecrets({
              satelliteId: authenticatedSatellite.id,
              configId: parsed.configId,
              collectorId: parsed.collectorId,
            });
            this.sendMessage(ws, {
              type: "run_secrets",
              requestId: parsed.requestId,
              env,
            });
          } catch (error) {
            this.sendMessage(ws, {
              type: "run_secrets",
              requestId: parsed.requestId,
              error: extractErrorMessage(error),
            });
          }
          break;
        }
        case "request_config_secrets": {
          // JIT config-secret delivery: resolve the `x-secret` fields of the
          // satellite's OWN assignment (strategy + collector configs) and
          // reply with field-path -> value maps. On any failure, reply with
          // an error so the satellite fails the run clearly.
          if (!this.secretSink?.resolveConfigSecrets) {
            this.sendMessage(ws, {
              type: "config_secrets",
              requestId: parsed.requestId,
              error:
                "Config-secret delivery is not available on this core instance.",
            });
            break;
          }
          try {
            const resolved = await this.secretSink.resolveConfigSecrets({
              satelliteId: authenticatedSatellite.id,
              configId: parsed.configId,
            });
            this.sendMessage(ws, {
              type: "config_secrets",
              requestId: parsed.requestId,
              strategy: resolved.strategy,
              collectors: resolved.collectors,
            });
          } catch (error) {
            this.sendMessage(ws, {
              type: "config_secrets",
              requestId: parsed.requestId,
              error: extractErrorMessage(error),
            });
          }
          break;
        }
        case "authenticate": {
          // Already authenticated, ignore duplicate auth attempts
          this.logger.debug(
            `Satellite ${authenticatedSatellite.name} sent duplicate authenticate`,
          );
          break;
        }
      }
    };

    const onClose = () => {
      if (authenticatedSatellite) {
        const closedSatellite = authenticatedSatellite;
        this.connections.delete(closedSatellite.id);
        this.logger.info(
          `Satellite disconnected: ${closedSatellite.name} (${closedSatellite.region})`,
        );
        if (this.connectionEntitySink) {
          // Fire-and-forget — `onClose` is sync, so don't await; we don't have
          // a place to surface a rejection anyway. Clear `lastHeartbeatAt`
          // (`null`) so the computed status flips `offline` IMMEDIATELY on a
          // clean disconnect (no waiting for the heartbeat to age out), and set
          // `lastConnectionEvent = "disconnected"` so the deriver re-fires
          // `satellite.disconnected`. Nulling the heartbeat coincides with the
          // "never connected" representation, but `lastConnectionEvent` stays
          // `"disconnected"` (non-null), so the entity still HAS state — the
          // read only omits a satellite whose `lastConnectionEvent` is null.
          void this.connectionEntitySink
            .mirror({
              satelliteId: closedSatellite.id,
              lastEvent: "disconnected",
              lastHeartbeatAt: null,
            })
            .catch((error: unknown) => {
              this.logger.error(
                `Failed to mirror satellite-connection (disconnected) for ${closedSatellite.name}:`,
                error,
              );
            });
        }
      }
    };

    return { onMessage, onClose };
  }

  /**
   * Push a config update to a specific satellite.
   */
  async pushConfigUpdate(satelliteId: string): Promise<void> {
    const conn = this.connections.get(satelliteId);
    if (!conn) return;

    const assignments =
      await this.configRelay.getAssignmentsForSatellite(satelliteId);
    const scriptPackagesLockfileHash = await this.resolveDesiredLockfileHash();

    // Keep the result-authorization cache in lockstep with the pushed
    // assignments so a reassignment immediately changes what the satellite may
    // report for (a removed assignment can no longer post results, a new one
    // can). The durable assignment tables remain the source of truth.
    conn.allowedResults = buildAllowedResults(assignments);

    this.sendMessage(conn.ws, {
      type: "config_updated",
      assignments,
      ...(scriptPackagesLockfileHash === undefined
        ? {}
        : { scriptPackagesLockfileHash }),
    });

    this.logger.debug(
      `Pushed config update to satellite ${conn.satellite.name}: ${assignments.length} assignments`,
    );
  }

  /**
   * Push a `refresh_script_packages` to every connected satellite. Called by
   * the `script-packages.changed` broadcast handler so each core instance
   * fans the refresh out to its own satellites. Best-effort liveness; the
   * assignment-carried hash is the durable backstop.
   */
  pushRefreshScriptPackagesToAll(lockfileHash: string): void {
    for (const conn of this.connections.values()) {
      this.sendMessage(conn.ws, {
        type: "refresh_script_packages",
        lockfileHash,
      });
    }
    this.logger.debug(
      `Pushed refresh_script_packages (${lockfileHash}) to ${this.connections.size} satellite(s)`,
    );
  }

  /**
   * Push the new global sandbox policy to EVERY connected satellite. Called by
   * the `script-sandbox.policy-changed` broadcast handler so each core instance
   * fans the change out to its own satellites (push-on-change relay).
   * Best-effort liveness; the policy carried in `authenticated` on (re)connect
   * is the durable backstop.
   */
  pushSandboxPolicyToAll(policy: SandboxPolicy): void {
    for (const conn of this.connections.values()) {
      this.sendMessage(conn.ws, { type: "sandbox_policy", policy });
    }
    this.logger.debug(
      `Pushed sandbox_policy to ${this.connections.size} satellite(s)`,
    );
  }

  // ─── Telemetry / capability routing ───────────────────────────────────────

  /**
   * Route one inbound `telemetry_batch`: dedupe by batchId, enforce the
   * per-connection byte budget, route to the registered handler for `kind`, and
   * ack. NOTHING here touches the health-result path. `raw` is the serialized
   * frame, used only to size the batch against the budget.
   */
  private async handleTelemetryBatch(
    satellite: SatelliteWithStatus,
    msg: TelemetryBatchMessage,
    raw: string,
  ): Promise<void> {
    const conn = this.connections.get(satellite.id);
    if (!conn) return;

    // Dedupe by batchId. `done` -> idempotently re-ack the remembered terminal
    // counts. `processing` -> a resend raced the in-flight original; DROP it
    // (no re-route, no ack) so the handler runs exactly once - the agent settles
    // on the original's ack. Only a batchId NOT in the window is processed.
    const remembered = conn.telemetryDedupe.get(msg.batchId);
    if (remembered) {
      if (remembered.status === "done") {
        this.sendMessage(conn.ws, {
          type: "telemetry_ack",
          batchId: msg.batchId,
          accepted: remembered.accepted,
          rejected: remembered.rejected,
          retryable: false,
        });
      }
      return;
    }

    // Per-connection bytes/min budget: over-budget -> retryable ack + warn,
    // NEVER a disconnect. The window rolls once per minute. Checked BEFORE the
    // `processing` marker so an over-budget batch stays fully resend-eligible.
    const now = Date.now();
    if (now - conn.telemetryBudgetWindowStart >= 60_000) {
      conn.telemetryBudgetWindowStart = now;
      conn.telemetryBudgetBytesUsed = 0;
    }
    const bytes = Buffer.byteLength(raw, "utf8");
    if (
      conn.telemetryBudgetBytesUsed + bytes >
      TELEMETRY_BUDGET_BYTES_PER_MIN
    ) {
      this.logger.warn(
        `Satellite ${satellite.name} exceeded its telemetry byte budget; ` +
          `asking it to retry (kind=${msg.kind})`,
      );
      // Over-budget before any `processing` marker was set: send a plain
      // retryable ack (nothing to finalize; the batch stays resend-eligible).
      this.finalizeTelemetry(conn, msg.batchId, {
        accepted: 0,
        rejected: 0,
        retryable: true,
      });
      return;
    }
    conn.telemetryBudgetBytesUsed += bytes;

    const handler = this.capabilityRouter?.getHandler(msg.kind);
    if (!handler?.handleTelemetryBatch) {
      // No handler will ever accept this kind -> terminal, non-retryable.
      this.logger.warn(
        `Satellite ${satellite.name} sent telemetry for unhandled kind ` +
          `"${msg.kind}"; dropping (non-retryable)`,
      );
      this.finalizeTelemetry(conn, msg.batchId, {
        accepted: 0,
        rejected: 0,
        retryable: false,
      });
      return;
    }

    // Mark the batch in-flight BEFORE awaiting the handler so a resend that
    // races the (non-idempotent) handler is dropped by the dedupe check above
    // instead of being processed a second time.
    conn.telemetryDedupe.set(msg.batchId, { status: "processing" });

    try {
      const outcome = await handler.handleTelemetryBatch({
        satelliteId: satellite.id,
        payload: msg.payload,
        // Forward the envelope's per-group in-transit drop counts so the handler
        // can attribute the loss to the exact stream (a satellite-buffer drop,
        // distinct from any core drop).
        droppedByGroup: msg.droppedByGroup,
      });
      this.finalizeTelemetry(conn, msg.batchId, {
        accepted: outcome.accepted,
        rejected: outcome.rejected,
        retryable: outcome.retryable ?? false,
      });
    } catch (error) {
      // A throw is a TRANSIENT failure -> retryable, so the agent resends.
      this.logger.error(
        `Telemetry handler for kind "${msg.kind}" threw ` +
          `(satellite ${satellite.name}):`,
        error,
      );
      this.finalizeTelemetry(conn, msg.batchId, {
        accepted: 0,
        rejected: 0,
        retryable: true,
      });
    }
  }

  /**
   * Settle a telemetry batch and ack it. A TERMINAL outcome is remembered as
   * `done` (bounded window, oldest evicted) so a later resend is idempotently
   * re-acked; a RETRYABLE outcome DELETES the `processing` marker so a
   * legitimate resend re-processes (a delete of an absent key - e.g. the
   * over-budget path that never marked `processing` - is a harmless no-op).
   */
  private finalizeTelemetry(
    conn: SatelliteConnection,
    batchId: string,
    ack: { accepted: number; rejected: number; retryable: boolean },
  ): void {
    if (ack.retryable) {
      conn.telemetryDedupe.delete(batchId);
    } else {
      conn.telemetryDedupe.set(batchId, {
        status: "done",
        accepted: ack.accepted,
        rejected: ack.rejected,
      });
      // Bound the window: evict oldest (Map preserves insertion order). A
      // `processing` entry is never the oldest here (it was just re-set to
      // `done`), so eviction only removes settled entries.
      while (conn.telemetryDedupe.size > TELEMETRY_DEDUPE_WINDOW) {
        const oldest = conn.telemetryDedupe.keys().next().value;
        if (oldest === undefined) break;
        conn.telemetryDedupe.delete(oldest);
      }
    }
    this.sendMessage(conn.ws, { type: "telemetry_ack", batchId, ...ack });
  }

  /**
   * Answer a `capability_secret_request` by routing it to the registered
   * handler's `resolveSecret` for `kind`, then replying with a
   * `capability_secret_response` (same requestId). No handler / no resolver for
   * the kind -> an error reply, so the agent skips that poll clearly rather than
   * hanging on a reply that never comes. Mirrors the health-check
   * `request_run_secrets` path: the handler enforces the binding (the satellite
   * names a resource; it does not choose an arbitrary secret), and the value
   * rides only this authenticated channel.
   */
  private async handleCapabilitySecretRequest(
    satellite: SatelliteWithStatus,
    msg: CapabilitySecretRequestMessage,
  ): Promise<void> {
    const conn = this.connections.get(satellite.id);
    if (!conn) return;
    const handler = this.capabilityRouter?.getHandler(msg.kind);
    if (!handler?.resolveSecret) {
      this.sendMessage(conn.ws, {
        type: "capability_secret_response",
        requestId: msg.requestId,
        error: `No secret resolver for capability "${msg.kind}" on this core instance.`,
      });
      return;
    }
    try {
      const resolved = await handler.resolveSecret({
        satelliteId: satellite.id,
        payload: msg.payload,
      });
      this.sendMessage(conn.ws, {
        type: "capability_secret_response",
        requestId: msg.requestId,
        ...(resolved.payload === undefined ? {} : { payload: resolved.payload }),
        ...(resolved.error === undefined ? {} : { error: resolved.error }),
      });
    } catch (error) {
      this.logger.error(
        `Capability secret resolver for kind "${msg.kind}" threw ` +
          `(satellite ${satellite.name}):`,
        error,
      );
      this.sendMessage(conn.ws, {
        type: "capability_secret_response",
        requestId: msg.requestId,
        error: extractErrorMessage(error),
      });
    }
  }

  /** Route a fire-and-forget `capability_status` to its handler (no ack). */
  private async handleCapabilityStatus(
    satellite: SatelliteWithStatus,
    msg: CapabilityStatusMessage,
  ): Promise<void> {
    const handler = this.capabilityRouter?.getHandler(msg.kind);
    if (!handler?.handleCapabilityStatus) return;
    try {
      await handler.handleCapabilityStatus({
        satelliteId: satellite.id,
        payload: msg.payload,
      });
    } catch (error) {
      this.logger.error(
        `Capability status handler for kind "${msg.kind}" threw ` +
          `(satellite ${satellite.name}):`,
        error,
      );
    }
  }

  /**
   * Rebuild + push `capability_config` for `kind` to the given satellite (or to
   * all connected satellites when `satelliteId` is omitted). Called by the
   * broadcast handler for the `satellite.capabilityConfigChanged` domain event
   * so whichever pod holds the socket does the push.
   */
  async pushCapabilityConfig(input: {
    kind: string;
    satelliteId?: string;
  }): Promise<void> {
    const handler = this.capabilityRouter?.getHandler(input.kind);
    if (!handler?.buildCapabilityConfig) return;

    const targets: SatelliteConnection[] = [];
    if (input.satelliteId === undefined) {
      targets.push(...this.connections.values());
    } else {
      const conn = this.connections.get(input.satelliteId);
      if (conn) targets.push(conn);
    }
    for (const conn of targets) {
      await this.pushCapabilityConfigForHandler(conn, handler);
    }
  }

  /** Push every registered capability's config to one freshly-connected socket. */
  private async pushAllCapabilityConfigs(satelliteId: string): Promise<void> {
    if (!this.capabilityRouter) return;
    const conn = this.connections.get(satelliteId);
    if (!conn) return;
    for (const handler of this.capabilityRouter.listHandlers()) {
      await this.pushCapabilityConfigForHandler(conn, handler);
    }
  }

  /** Build one handler's config for one connection and push it if non-null. */
  private async pushCapabilityConfigForHandler(
    conn: SatelliteConnection,
    handler: SatelliteCapabilityHandler,
  ): Promise<void> {
    if (!handler.buildCapabilityConfig) return;
    try {
      const payload = await handler.buildCapabilityConfig({
        satelliteId: conn.satellite.id,
      });
      if (payload === null || payload === undefined) return;
      this.sendMessage(conn.ws, {
        type: "capability_config",
        kind: handler.kind,
        payload,
      });
    } catch (error) {
      this.logger.error(
        `Failed to build capability_config for kind "${handler.kind}" ` +
          `(satellite ${conn.satellite.name}):`,
        error,
      );
    }
  }

  /**
   * Resolve the current global sandbox policy for the `authenticated` payload.
   * Returns `undefined` when the sink isn't wired or its read throws, so the
   * field is omitted (version-skew safe) and the satellite stays FAIL-CLOSED
   * (denies egress) - a relay failure must never loosen a satellite's sandbox.
   */
  private async resolveSandboxPolicy(): Promise<SandboxPolicy | undefined> {
    if (!this.sandboxPolicySink) return undefined;
    try {
      return await this.sandboxPolicySink.getCurrentPolicy();
    } catch (error) {
      this.logger.error("Failed to resolve global sandbox policy:", error);
      return undefined;
    }
  }

  /**
   * Resolve the desired lockfile hash for assignment payloads. Returns
   * `undefined` when the sink isn't wired (so the field is omitted entirely
   * for version-skew safety), or `string | null` from the sink.
   */
  private async resolveDesiredLockfileHash(): Promise<
    string | null | undefined
  > {
    if (!this.scriptPackageSink) return undefined;
    try {
      return await this.scriptPackageSink.getDesiredLockfileHash();
    } catch (error) {
      this.logger.error("Failed to resolve desired lockfile hash:", error);
      return undefined;
    }
  }

  /**
   * Send a shutdown message to a specific satellite (e.g., on token revocation).
   */
  sendShutdown(satelliteId: string, reason: string): void {
    const conn = this.connections.get(satelliteId);
    if (!conn) return;

    this.sendMessage(conn.ws, { type: "shutdown", reason });
    conn.ws.close();
    this.connections.delete(satelliteId);
  }

  /**
   * Push config updates to ALL currently connected satellites.
   * Called after association changes to ensure live satellites get updated assignments.
   */
  async pushConfigUpdateToAll(): Promise<void> {
    const connectedIds = this.getConnectedSatelliteIds();
    if (connectedIds.length === 0) return;

    this.logger.debug(
      `Pushing config updates to ${connectedIds.length} connected satellite(s)`,
    );

    await Promise.all(
      connectedIds.map((id) => this.pushConfigUpdate(id)),
    );
  }

  /**
   * Get the IDs of all currently connected satellites.
   */
  getConnectedSatelliteIds(): string[] {
    return [...this.connections.keys()];
  }

  private sendMessage(
    ws: WsConnection,
    message: CoreToSatelliteMessage,
  ): void {
    ws.send(JSON.stringify(message));
  }
}
