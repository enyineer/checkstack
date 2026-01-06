import type { Server, ServerWebSocket } from "bun";
import type { EventBus, Logger } from "@checkmate-monitor/backend-api";
import type { ServerToClientMessage } from "@checkmate-monitor/signal-common";
import { SIGNAL_BROADCAST_HOOK, SIGNAL_USER_HOOK } from "./hooks";

// =============================================================================
// TYPES
// =============================================================================

/**
 * WebSocket connection data attached on upgrade.
 * userId is optional - anonymous users can connect for broadcast signals.
 */
export interface WebSocketData {
  userId?: string;
  createdAt: number;
}

/**
 * Channel names for Bun's native pub/sub.
 */
const CHANNELS = {
  BROADCAST: "signals:broadcast",
  user: (userId: string) => `signals:user:${userId}`,
};

// =============================================================================
// WEBSOCKET HANDLER
// =============================================================================

export interface WebSocketHandlerConfig {
  eventBus: EventBus;
  logger: Logger;
}

export interface WebSocketHandler {
  /**
   * Set the Bun server reference after `Bun.serve()` returns.
   * This enables publishing to channels from EventBus subscribers.
   */
  setServer(server: Server<WebSocketData>): void;

  /**
   * WebSocket configuration object to pass to Bun.serve().
   */
  websocket: {
    data: WebSocketData;
    open(ws: ServerWebSocket<WebSocketData>): void | Promise<void>;
    message(
      ws: ServerWebSocket<WebSocketData>,
      message: string | Buffer
    ): void | Promise<void>;
    close(
      ws: ServerWebSocket<WebSocketData>,
      code: number,
      reason: string
    ): void | Promise<void>;
  };
}

/**
 * Create a WebSocket handler for Bun's native WebSocket server.
 *
 * Uses Bun's built-in pub/sub for efficient channel-based routing:
 * - `signals:broadcast` - all clients subscribe (including anonymous)
 * - `signals:user:{userId}` - user-specific messages (authenticated only)
 */
export function createWebSocketHandler(
  config: WebSocketHandlerConfig
): WebSocketHandler {
  const { eventBus, logger } = config;
  let server: Server<WebSocketData> | undefined;
  let eventBusInitialized = false;

  const setupEventBusListeners = async () => {
    if (eventBusInitialized || !server) return;
    eventBusInitialized = true;

    logger.debug("Setting up EventBus listeners for signal relay");

    // Subscribe to broadcast signals from EventBus
    await eventBus.subscribe(
      "signal-backend",
      SIGNAL_BROADCAST_HOOK,
      async (message) => {
        const payload: ServerToClientMessage = {
          type: "signal",
          signalId: message.signalId,
          payload: message.payload,
          timestamp: message.timestamp,
        };
        server!.publish(CHANNELS.BROADCAST, JSON.stringify(payload));
        logger.debug(`Relayed broadcast signal: ${message.signalId}`);
      },
      { mode: "broadcast" }
    );

    // Subscribe to user-specific signals from EventBus
    await eventBus.subscribe(
      "signal-backend",
      SIGNAL_USER_HOOK,
      async ({ userId, message }) => {
        const payload: ServerToClientMessage = {
          type: "signal",
          signalId: message.signalId,
          payload: message.payload,
          timestamp: message.timestamp,
        };
        server!.publish(CHANNELS.user(userId), JSON.stringify(payload));
        logger.debug(`Relayed signal ${message.signalId} to user ${userId}`);
      },
      { mode: "broadcast" }
    );

    logger.info("✅ Signal WebSocket relay initialized");
  };

  return {
    setServer: (s: Server<WebSocketData>) => {
      server = s;
      void setupEventBusListeners();
    },

    websocket: {
      // Type template for ws.data (used by TypeScript)
      data: {} as WebSocketData,

      open(ws: ServerWebSocket<WebSocketData>) {
        const { userId } = ws.data;
        logger.debug(
          `WebSocket opened${userId ? ` for user ${userId}` : " (anonymous)"}`
        );

        // All clients subscribe to broadcast channel
        ws.subscribe(CHANNELS.BROADCAST);

        // Only authenticated users subscribe to their private channel
        if (userId) {
          ws.subscribe(CHANNELS.user(userId));
        }

        // Send connected confirmation
        const msg: ServerToClientMessage = {
          type: "connected",
          userId: userId ?? "anonymous",
        };
        ws.send(JSON.stringify(msg));
      },

      message(ws: ServerWebSocket<WebSocketData>, message: string | Buffer) {
        try {
          const data = JSON.parse(message.toString());
          if (data.type === "ping") {
            const pong: ServerToClientMessage = { type: "pong" };
            ws.send(JSON.stringify(pong));
          }
        } catch (error) {
          logger.warn("Invalid WebSocket message received", { error });
        }
      },

      close(ws: ServerWebSocket<WebSocketData>, code: number, reason: string) {
        const { userId } = ws.data;
        logger.debug(
          `WebSocket closed${userId ? ` for user ${userId}` : " (anonymous)"}`,
          { code, reason }
        );
        // Bun automatically unsubscribes from all channels on close
      },
    },
  };
}
