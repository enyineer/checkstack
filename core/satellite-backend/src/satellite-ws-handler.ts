import type { Hook, Logger } from "@checkstack/backend-api";
import type {
  WebSocketRouteHandler,
  WsConnection,
  WsConnectionHandlers,
} from "@checkstack/backend-api";
import type { SatelliteService } from "./service";
import type { ConfigRelay } from "./config-relay";
import {
  SatelliteToCoreMessageSchema,
  type CoreToSatelliteMessage,
  type ResultMessage,
  type SatelliteWithStatus,
} from "@checkstack/satellite-common";

/**
 * Optional plug-point for firing automation triggers when a satellite
 * connects or disconnects. Bound from `afterPluginsReady` where
 * `emitHook` is available — when not provided, no hook fires.
 */
export interface SatelliteConnectionHookSink {
  emitHook: <T>(hook: Hook<T>, payload: T) => Promise<void>;
  connectedHook: Hook<{
    satelliteId: string;
    name: string;
    region: string;
    timestamp: string;
  }>;
  disconnectedHook: Hook<{
    satelliteId: string;
    name: string;
    region: string;
    timestamp: string;
  }>;
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
  /** Map of satelliteId → active WebSocket connection */
  private connections = new Map<string, SatelliteConnection>();

  constructor(
    private service: SatelliteService,
    private configRelay: ConfigRelay,
    private resultHandler: SatelliteResultHandler,
    private logger: Logger,
    /**
     * Optional. When set, the handler fires `connected` / `disconnected`
     * hooks at the same lifecycle points it logs. Wired by
     * `afterPluginsReady` so the action graph stays decoupled from
     * `emitHook` availability.
     */
    private connectionHookSink?: SatelliteConnectionHookSink,
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

        // Fire the automation `connected` hook (best-effort — never
        // block the auth handshake on a hook subscriber failure).
        if (this.connectionHookSink) {
          try {
            await this.connectionHookSink.emitHook(
              this.connectionHookSink.connectedHook,
              {
                satelliteId: satellite.id,
                name: satellite.name,
                region: satellite.region,
                timestamp: new Date().toISOString(),
              },
            );
          } catch (error) {
            this.logger.error(
              `Failed to emit satellite.connected hook for ${satellite.name}:`,
              error,
            );
          }
        }

        // Update heartbeat on connect
        await this.service.updateHeartbeat(satellite.id, {});

        // Send authenticated response with full config
        const assignments =
          await this.configRelay.getAssignmentsForSatellite(satellite.id);

        this.sendMessage(ws, {
          type: "authenticated",
          satelliteId: satellite.id,
          assignments,
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
        if (this.connectionHookSink) {
          // Fire-and-forget — `onClose` is sync, so don't await; we
          // don't have a place to surface a rejection anyway.
          void this.connectionHookSink
            .emitHook(this.connectionHookSink.disconnectedHook, {
              satelliteId: closedSatellite.id,
              name: closedSatellite.name,
              region: closedSatellite.region,
              timestamp: new Date().toISOString(),
            })
            .catch((error: unknown) => {
              this.logger.error(
                `Failed to emit satellite.disconnected hook for ${closedSatellite.name}:`,
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

    this.sendMessage(conn.ws, {
      type: "config_updated",
      assignments,
    });

    this.logger.debug(
      `Pushed config update to satellite ${conn.satellite.name}: ${assignments.length} assignments`,
    );
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
