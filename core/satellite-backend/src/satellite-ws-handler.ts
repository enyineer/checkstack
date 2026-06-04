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
  type CoreToSatelliteMessage,
  type ResultMessage,
  type SatelliteWithStatus,
} from "@checkstack/satellite-common";
import type { SandboxPolicy } from "@checkstack/common";

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
 */
interface SatelliteConnection {
  satellite: SatelliteWithStatus;
  ws: WsConnection;
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

        // Track connection
        this.connections.set(satellite.id, { satellite, ws });

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
        const assignments =
          await this.configRelay.getAssignmentsForSatellite(satellite.id);
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
        return;
      }

      // Post-authentication: handle all message types
      switch (parsed.type) {
        case "heartbeat": {
          await this.service.updateHeartbeat(authenticatedSatellite.id, {
            version: parsed.version,
          });
          break;
        }
        case "result": {
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
