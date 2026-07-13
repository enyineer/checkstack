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
  TelemetryBatchMessage,
  TelemetryAckMessage,
} from "@checkstack/satellite-common";
import type { SandboxPolicy } from "@checkstack/backend-api";
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
  /**
   * Called with the relayed GLOBAL sandbox policy - on connect (carried in the
   * `authenticated` message) and on a `sandbox_policy` push. The satellite
   * caches it and resolves every script run through it. Until the first call
   * the satellite FAILS CLOSED (denies egress).
   */
  onSandboxPolicy?: (policy: SandboxPolicy) => void;
  /**
   * Capabilities this satellite advertises (e.g. "telemetry", "scrape"). Sent
   * in every `authenticate` and `heartbeat` so the core can gate features and
   * surface them in the UI. Omitted from the wire when empty/undefined.
   */
  capabilities?: string[];
  /**
   * Called when the socket has authenticated (connection is usable). Used to
   * resume the telemetry sender's credit window. Distinct from `onAssignments`,
   * which carries health-check config only.
   */
  onConnected?: () => void;
  /** Called when the core acks a forwarded telemetry batch. */
  onTelemetryAck?: (ack: TelemetryAckMessage) => void;
  /** Called when the core pushes a capability's configuration. */
  onCapabilityConfig?: (input: { kind: string; payload: unknown }) => void;
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
  // Pending config-secret requests, keyed by requestId, resolved/rejected
  // when the matching `config_secrets` reply arrives.
  private readonly pendingConfigSecrets = new Map<
    string,
    {
      resolve: (resolved: {
        strategy: Record<string, string>;
        collectors: Record<string, Record<string, string>>;
      }) => void;
      reject: (error: Error) => void;
    }
  >();
  // Pending capability-secret requests (e.g. a scrape target's JIT bearer),
  // keyed by requestId, settled when the matching `capability_secret_response`
  // arrives. Unlike run/config secrets this NEVER rejects: a resolution/binding
  // failure comes back on the envelope's `error` field, and a timeout resolves
  // an `error` too, so the caller (the scrape scheduler) always gets a verdict
  // object and decides whether to skip.
  private readonly pendingCapabilitySecrets = new Map<
    string,
    (result: { payload?: unknown; error?: string }) => void
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

  /**
   * Request just-in-time CONFIG secrets for an assignment from core: the
   * resolved values of `x-secret` strategy/collector config fields that the
   * relayed assignment carries only as markers / references. Rejects on a
   * resolution error or timeout so the run fails clearly rather than probing
   * with a marker string as a credential. Values are held in memory only.
   */
  requestConfigSecrets(
    input: { configId: string; runId: string },
    timeoutMs = 30_000,
  ): Promise<{
    strategy: Record<string, string>;
    collectors: Record<string, Record<string, string>>;
  }> {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.pendingConfigSecrets.delete(requestId);
        reject(
          new Error(
            `Config-secret delivery timed out for ${input.configId} (run ${input.runId})`,
          ),
        );
      }, timeoutMs);
      this.pendingConfigSecrets.set(requestId, {
        resolve: (resolved) => {
          clearTimeout(timer);
          resolve(resolved);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.sendMessage({
        type: "request_config_secrets",
        requestId,
        configId: input.configId,
        runId: input.runId,
      });
    });
  }

  /**
   * Request a capability's just-in-time secret from core (e.g. a scrape
   * target's bearer token). The `payload` names the resource whose secret is
   * needed (handler-validated - e.g. `{ targetId }` for "metric-scrape"); core
   * verifies the binding, resolves the secret, and replies with a
   * `capability_secret_response`. Resolves to `{ payload?, error? }` and NEVER
   * rejects: a resolution/binding failure comes back as `error`, and a timeout
   * also resolves an `error`, so the caller always gets a verdict and decides
   * whether to skip. The secret is held in memory only for the poll interval.
   */
  requestCapabilitySecret(
    input: { kind: string; payload: unknown },
    timeoutMs = 30_000,
  ): Promise<{ payload?: unknown; error?: string }> {
    return new Promise((resolve) => {
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.pendingCapabilitySecrets.delete(requestId);
        resolve({
          error: `Capability secret request timed out (kind ${input.kind})`,
        });
      }, timeoutMs);
      this.pendingCapabilitySecrets.set(requestId, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
      this.sendMessage({
        type: "capability_secret_request",
        requestId,
        kind: input.kind,
        payload: input.payload,
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
          ...(this.config.capabilities && this.config.capabilities.length > 0
            ? { capabilities: this.config.capabilities }
            : {}),
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

  /**
   * Forward a telemetry batch to the core. Unlike `sendResult`, telemetry is
   * NOT buffered here - the TelemetryClient owns bounded per-kind buffering and
   * the credit window, and only pumps while connected. A send while
   * disconnected is a no-op (the batch stays in the TelemetryClient's buffer /
   * in-flight set and is resent on reconnect).
   */
  sendTelemetry(msg: TelemetryBatchMessage): void {
    this.sendMessage(msg);
  }

  /** Forward a fire-and-forget capability status update to the core. */
  sendCapabilityStatus(input: { kind: string; payload: unknown }): void {
    this.sendMessage({
      type: "capability_status",
      kind: input.kind,
      payload: input.payload,
    });
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
        this.config.onConnected?.();
        this.config.onAssignments(msg.assignments);
        // Durable backstop: reconcile to the assignment-carried hash on
        // every (re)connect, even if a refresh push was missed offline.
        if (msg.scriptPackagesLockfileHash !== undefined) {
          this.config.onScriptPackagesLockfileHash?.(
            msg.scriptPackagesLockfileHash,
          );
        }
        // Sandbox policy relay (durable backstop): cache the policy carried on
        // (re)connect so runs enforce the operator's cluster-wide policy. Until
        // this arrives the satellite stays fail-closed (deny egress).
        if (msg.sandboxPolicy !== undefined) {
          this.config.onSandboxPolicy?.(msg.sandboxPolicy);
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

      case "sandbox_policy": {
        // Push-on-change: replace the cached global sandbox policy so the next
        // run enforces it immediately.
        this.config.logger?.info("Received updated global sandbox policy");
        this.config.onSandboxPolicy?.(msg.policy);
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

      case "config_secrets": {
        const pending = this.pendingConfigSecrets.get(msg.requestId);
        this.pendingConfigSecrets.delete(msg.requestId);
        if (!pending) break;
        if (msg.error === undefined) {
          pending.resolve({
            strategy: msg.strategy ?? {},
            collectors: msg.collectors ?? {},
          });
        } else {
          pending.reject(new Error(msg.error));
        }
        break;
      }

      case "capability_secret_response": {
        // Settle the pending request with a verdict object (never throws): the
        // handler may report success (`payload`) or failure (`error`).
        const settle = this.pendingCapabilitySecrets.get(msg.requestId);
        this.pendingCapabilitySecrets.delete(msg.requestId);
        settle?.({ payload: msg.payload, error: msg.error });
        break;
      }

      case "telemetry_ack": {
        this.config.onTelemetryAck?.(msg);
        break;
      }

      case "capability_config": {
        this.config.onCapabilityConfig?.({
          kind: msg.kind,
          payload: msg.payload,
        });
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
          ...(this.config.capabilities && this.config.capabilities.length > 0
            ? { capabilities: this.config.capabilities }
            : {}),
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
