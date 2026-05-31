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
  ScriptPackageSyncStateMessage,
} from "@checkstack/satellite-common";
import { ResultBuffer } from "./result-buffer";

interface ManifestEntryWire {
  name: string;
  version: string;
  integrity: string;
}

interface SatelliteClientConfig {
  coreUrl: string;
  clientId: string;
  token: string;
  version: string;
  onAssignments: (assignments: SatelliteAssignment[]) => void;
  onDisconnect?: () => void;
  /**
   * Called with the desired script-package lockfile hash whenever the core
   * signals one - on connect (assignment-carried backstop) and on a
   * `refresh_script_packages` push. The satellite reconciles to it.
   */
  onScriptPackagesLockfileHash?: (lockfileHash: string | null) => void;
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
  // Pending script-package request promises, resolved when the matching
  // core reply arrives. Keyed by lockfileHash (manifest) / integrity (blob).
  private readonly pendingManifest = new Map<
    string,
    (entries: ManifestEntryWire[]) => void
  >();
  private readonly pendingBlob = new Map<
    string,
    (data: string | null) => void
  >();
  // Pending run-secret requests, keyed by requestId, resolved/rejected when
  // the matching `run_secrets` reply arrives.
  private readonly pendingRunSecrets = new Map<
    string,
    {
      resolve: (env: Record<string, string>) => void;
      reject: (error: Error) => void;
    }
  >();

  constructor(config: SatelliteClientConfig) {
    this.config = config;
  }

  /**
   * Request the manifest for a lockfile hash from core (over the WS channel).
   * Resolves when the core replies, or rejects on timeout.
   */
  requestManifest(
    lockfileHash: string,
    timeoutMs = 30_000,
  ): Promise<ManifestEntryWire[]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingManifest.delete(lockfileHash);
        reject(new Error(`Manifest request timed out for ${lockfileHash}`));
      }, timeoutMs);
      this.pendingManifest.set(lockfileHash, (entries) => {
        clearTimeout(timer);
        resolve(entries);
      });
      this.sendMessage({
        type: "request_script_package_manifest",
        lockfileHash,
      });
    });
  }

  /** Request one blob (base64) from core. Resolves null if core lacks it. */
  requestBlob(integrity: string, timeoutMs = 60_000): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingBlob.delete(integrity);
        reject(new Error(`Blob request timed out for ${integrity}`));
      }, timeoutMs);
      this.pendingBlob.set(integrity, (data) => {
        clearTimeout(timer);
        resolve(data);
      });
      this.sendMessage({ type: "request_script_package_blob", integrity });
    });
  }

  /**
   * Request just-in-time secret env for a collector run from core. Core
   * resolves the collector's declared `secretEnv` (from the satellite's own
   * assignment) and replies with the env map. Rejects on a resolution error
   * or timeout so the caller fails the run clearly rather than running
   * without the secret. The returned env is held in memory only.
   */
  requestRunSecrets(
    input: { configId: string; collectorId: string; runId: string },
    timeoutMs = 30_000,
  ): Promise<Record<string, string>> {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.pendingRunSecrets.delete(requestId);
        reject(
          new Error(
            `Run-secret delivery timed out for ${input.collectorId} (run ${input.runId})`,
          ),
        );
      }, timeoutMs);
      this.pendingRunSecrets.set(requestId, {
        resolve: (env) => {
          clearTimeout(timer);
          resolve(env);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.sendMessage({
        type: "request_run_secrets",
        requestId,
        configId: input.configId,
        collectorId: input.collectorId,
        runId: input.runId,
      });
    });
  }

  /** Report this satellite's script-package reconcile state to core. */
  reportScriptPackageSyncState(
    state: Omit<ScriptPackageSyncStateMessage, "type">,
  ): void {
    this.sendMessage({ type: "script_package_sync_state", ...state });
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
        // Durable backstop: reconcile to the assignment-carried hash on
        // every (re)connect, even if a refresh push was missed offline.
        if (msg.scriptPackagesLockfileHash !== undefined) {
          this.config.onScriptPackagesLockfileHash?.(
            msg.scriptPackagesLockfileHash,
          );
        }
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
        if (msg.scriptPackagesLockfileHash !== undefined) {
          this.config.onScriptPackagesLockfileHash?.(
            msg.scriptPackagesLockfileHash,
          );
        }
        break;
      }

      case "refresh_script_packages": {
        this.config.logger?.info(
          `Script packages refresh requested: ${msg.lockfileHash}`,
        );
        this.config.onScriptPackagesLockfileHash?.(msg.lockfileHash);
        break;
      }

      case "script_package_manifest": {
        // The pending callback is looked up by a message-supplied key. Validate
        // that what we got back is actually callable before invoking it, so an
        // unknown/forged key can never dispatch to an unexpected target.
        const resolveManifest = this.pendingManifest.get(msg.lockfileHash);
        this.pendingManifest.delete(msg.lockfileHash);
        if (typeof resolveManifest === "function") resolveManifest(msg.entries);
        break;
      }

      case "script_package_blob": {
        const resolveBlob = this.pendingBlob.get(msg.integrity);
        this.pendingBlob.delete(msg.integrity);
        if (typeof resolveBlob === "function") resolveBlob(msg.data);
        break;
      }

      case "run_secrets": {
        const pending = this.pendingRunSecrets.get(msg.requestId);
        this.pendingRunSecrets.delete(msg.requestId);
        if (!pending) break;
        if (msg.error !== undefined || msg.env === undefined) {
          pending.reject(
            new Error(
              msg.error ?? "Required secret not available on this satellite",
            ),
          );
        } else {
          pending.resolve(msg.env);
        }
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
