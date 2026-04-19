import {
  HEARTBEAT_INTERVAL_MS,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
} from "@checkstack/satellite-common";
import type {
  SatelliteAssignment,
  CoreToSatelliteMessage,
  SatelliteToCoreMessage,
  ResultMessage,
} from "@checkstack/satellite-common";
import { ResultBuffer } from "./result-buffer";

interface SatelliteClientConfig {
  coreUrl: string;
  clientId: string;
  token: string;
  version: string;
  onAssignments: (assignments: SatelliteAssignment[]) => void;
  onDisconnect?: () => void;
  logger?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
    debug: (msg: string) => void;
  };
}

/**
 * WebSocket client for connecting a satellite to the core.
 * Handles authentication, heartbeats, result delivery, and reconnection.
 */
export class SatelliteClient {
  private ws: WebSocket | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private reconnectAttempt = 0;
  private startTime = Date.now();
  private connected = false;
  private readonly resultBuffer = new ResultBuffer();
  private readonly config: SatelliteClientConfig;

  constructor(config: SatelliteClientConfig) {
    this.config = config;
  }

  /**
   * Start the connection loop. Connects and automatically reconnects on failure.
   */
  async connect(): Promise<void> {
    const wsUrl = this.buildWsUrl();
    this.config.logger?.info(`Connecting to core at ${wsUrl}...`);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.addEventListener("open", () => {
        this.config.logger?.info("WebSocket connection established");
        this.sendMessage({
          type: "authenticate",
          clientId: this.config.clientId,
          token: this.config.token,
        });
      });

      this.ws.addEventListener("message", (event) => {
        this.handleMessage(String(event.data));
      });

      this.ws.addEventListener("close", (event) => {
        this.config.logger?.warn(
          `WebSocket closed: ${event.code} ${event.reason}`,
        );
        this.handleDisconnect();
      });

      this.ws.addEventListener("error", () => {
        this.config.logger?.error("WebSocket error");
      });
    } catch (error) {
      this.config.logger?.error(`Connection failed: ${String(error)}`);
      this.scheduleReconnect();
    }
  }

  /**
   * Send a health check result to the core.
   * If disconnected, the result is buffered for later delivery.
   */
  sendResult(result: ResultMessage): void {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      this.sendMessage(result);
    } else {
      this.resultBuffer.push(result);
      this.config.logger?.debug(
        `Buffered result (${this.resultBuffer.size} total)`,
      );
    }
  }

  /** Gracefully disconnect */
  disconnect(): void {
    this.stopHeartbeat();
    this.connected = false;
    this.ws?.close(1000, "Client shutdown");
  }

  private handleMessage(raw: string): void {
    let msg: CoreToSatelliteMessage;
    try {
      msg = JSON.parse(raw) as CoreToSatelliteMessage;
    } catch {
      this.config.logger?.warn(`Invalid message from core: ${raw}`);
      return;
    }

    switch (msg.type) {
      case "authenticated": {
        this.config.logger?.info(
          `Authenticated as ${msg.satelliteId}, received ${msg.assignments.length} assignments`,
        );
        this.connected = true;
        this.reconnectAttempt = 0;
        this.startHeartbeat();
        this.flushBuffer();
        this.config.onAssignments(msg.assignments);
        break;
      }

      case "auth_failed": {
        this.config.logger?.error(`Authentication failed: ${msg.reason}`);
        // Don't reconnect on auth failure — credentials are wrong
        this.ws?.close(4001, "Auth failed");
        break;
      }

      case "config_updated": {
        this.config.logger?.info(
          `Config updated: ${msg.assignments.length} assignments`,
        );
        this.config.onAssignments(msg.assignments);
        break;
      }

      case "shutdown": {
        this.config.logger?.warn(`Shutdown requested: ${msg.reason}`);
        this.disconnect();
        break;
      }
    }
  }

  private handleDisconnect(): void {
    this.connected = false;
    this.stopHeartbeat();
    this.config.onDisconnect?.();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    const delay = this.calculateBackoff();
    this.reconnectAttempt++;
    this.config.logger?.info(
      `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})...`,
    );
    setTimeout(() => void this.connect(), delay);
  }

  /**
   * Exponential backoff with jitter.
   * Delay = min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2^attempt) ± jitter
   */
  private calculateBackoff(): number {
    const exponential = RECONNECT_BASE_MS * 2 ** this.reconnectAttempt;
    const capped = Math.min(exponential, RECONNECT_MAX_MS);
    // Add ±25% jitter
    const jitter = capped * 0.25 * (Math.random() * 2 - 1);
    return Math.round(capped + jitter);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
        this.sendMessage({
          type: "heartbeat",
          version: this.config.version,
          uptimeSeconds: Math.round((Date.now() - this.startTime) / 1000),
        });
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private flushBuffer(): void {
    if (this.resultBuffer.isEmpty) return;

    const buffered = this.resultBuffer.flush();
    this.config.logger?.info(
      `Flushing ${buffered.length} buffered results to core`,
    );
    for (const result of buffered) {
      this.sendMessage(result);
    }
  }

  private sendMessage(msg: SatelliteToCoreMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private buildWsUrl(): string {
    const base = this.config.coreUrl
      .replace(/^http:/, "ws:")
      .replace(/^https:/, "wss:");
    return `${base.replace(/\/$/, "")}/api/ws/satellite`;
  }
}
