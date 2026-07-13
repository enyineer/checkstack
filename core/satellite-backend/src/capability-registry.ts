import { createExtensionPoint } from "@checkstack/backend-api";
import type { Logger, PluginMetadata } from "@checkstack/common";

/**
 * A domain plugin's contribution to the satellite telemetry/capability channel.
 *
 * satellite-backend OWNS this contract; the OWNING DOMAIN plugin SUPPLIES the
 * implementation by registering against {@link satelliteCapabilityExtensionPoint}
 * in its own `register()` / `afterPluginsReady()`. This inverts the dependency
 * so satellite-backend never imports a domain plugin (see dependencies.md): it
 * routes generic `telemetry_batch` / `capability_status` envelopes to the
 * handler registered for their `kind`, and pushes `capability_config` built by
 * the handler - all without knowing what any `kind` means.
 *
 * `kind` is a stable global string ("logstream", "metricstream",
 * "metric-scrape"); the agent tags each batch/status with it and the core routes
 * on it. The `payload` is opaque to the platform and validated by the handler.
 */
export interface SatelliteCapabilityHandler {
  /** The capability kind this handler owns (e.g. "logstream"). */
  kind: string;
  /**
   * Ingest one forwarded telemetry batch. Return the per-item outcome. Set
   * `retryable: true` for a TRANSIENT failure (sink hiccup) so the agent
   * resends; omit or `false` for a terminal rejection (auth-rejected) so the
   * agent drops the batch and counts the loss. A throw is treated as a
   * transient (retryable) failure by the WS handler.
   */
  handleTelemetryBatch?(ctx: {
    satelliteId: string;
    payload: unknown;
    /**
     * Telemetry the SATELLITE dropped from its bounded in-memory buffer since
     * the last batch of this kind (a disconnect / slow-consumer episode - a
     * distinct failure mode from any core-side drop), keyed BY THE GROUP the loss
     * belongs to. The group key is a DOMAIN string this handler defines and
     * interprets (the per-stream source token for the forward paths, the scrape
     * target id for `metric-scrape`), so the handler can attribute the loss to
     * the exact stream that lost data rather than spreading one aggregate across
     * every stream in the batch. Carried on the `telemetry_batch` envelope and
     * surfaced on the handler's own read model (e.g. a stream's "dropped in
     * transit" counter). Optional: absent when nothing was dropped.
     */
    droppedByGroup?: Record<string, number>;
  }): Promise<{ accepted: number; rejected: number; retryable?: boolean }>;
  /**
   * Build the capability configuration to push to a satellite (e.g. its bound
   * scrape targets). Called after `authenticated` and on every
   * `notifyCapabilityConfigChanged`. Return `null` to push nothing for this
   * satellite. Secrets MUST NOT ride this config - use the JIT secret channel.
   */
  buildCapabilityConfig?(ctx: {
    satelliteId: string;
  }): Promise<unknown | null>;
  /** Handle a fire-and-forget status update from a satellite (no ack). */
  handleCapabilityStatus?(ctx: {
    satelliteId: string;
    payload: unknown;
  }): Promise<void>;
  /**
   * Resolve a just-in-time secret for a `capability_secret_request` (e.g. a
   * scrape target's bearer token). The GENERIC analogue of the health-check
   * secret path: the handler resolves from ITS OWN durable state and MUST
   * validate that the requested resource is bound to `satelliteId` (binding is
   * the authorization - the satellite names a resource, it does not choose an
   * arbitrary secret). Return `{ payload }` with the resolved secret (opaque
   * here; validated by the agent's consumer for this `kind`, e.g.
   * `{ bearerToken }`) or `{ error }` on a binding/resolution failure. Secrets
   * resolved here MUST NOT be persisted and MUST NOT ride `buildCapabilityConfig`.
   */
  resolveSecret?(ctx: {
    satelliteId: string;
    payload: unknown;
  }): Promise<{ payload?: unknown; error?: string }>;
}

/**
 * The extension-point surface a DOMAIN plugin uses: register a handler, and
 * trigger a re-push of a kind's `capability_config` when its underlying data
 * changes (e.g. a scrape-target CRUD mutation).
 */
export interface SatelliteCapabilityRegistry {
  registerCapability(
    handler: SatelliteCapabilityHandler,
    meta: PluginMetadata,
  ): void;
  /**
   * Ask the core to rebuild + push `capability_config` for `kind` to the given
   * satellite (or to all connected satellites when `satelliteId` is omitted).
   * Cross-pod: satellite-backend fans this out via a broadcast domain event so
   * whichever pod holds the socket does the push.
   */
  notifyCapabilityConfigChanged(input: {
    kind: string;
    satelliteId?: string;
  }): void;
}

/**
 * The read side the WS handler uses to route inbound envelopes and build
 * configs. Kept separate from {@link SatelliteCapabilityRegistry} so the
 * extension point exposes only the contribution surface to domain plugins.
 */
export interface SatelliteCapabilityRouter {
  getHandler(kind: string): SatelliteCapabilityHandler | undefined;
  listHandlers(): SatelliteCapabilityHandler[];
}

/**
 * Concrete registry: buffers handler registrations (load-order independent) and
 * relays `notifyCapabilityConfigChanged` to a broadcast emitter bound in
 * `afterPluginsReady` (before which no satellite can be connected anyway).
 */
export class SatelliteCapabilityRegistryImpl
  implements SatelliteCapabilityRegistry, SatelliteCapabilityRouter
{
  private readonly handlers = new Map<string, SatelliteCapabilityHandler>();
  private emitConfigChanged?: (input: {
    kind: string;
    satelliteId?: string;
  }) => void;

  constructor(private readonly logger?: Logger) {}

  registerCapability(
    handler: SatelliteCapabilityHandler,
    meta: PluginMetadata,
  ): void {
    if (this.handlers.has(handler.kind)) {
      this.logger?.warn(
        `Satellite capability kind "${handler.kind}" is already registered; ` +
          `ignoring duplicate from plugin ${meta.pluginId}`,
      );
      return;
    }
    this.handlers.set(handler.kind, handler);
    this.logger?.debug(
      `Registered satellite capability "${handler.kind}" (plugin ${meta.pluginId})`,
    );
  }

  notifyCapabilityConfigChanged(input: {
    kind: string;
    satelliteId?: string;
  }): void {
    this.emitConfigChanged?.(input);
  }

  /**
   * Bind the broadcast emitter that fans `notifyCapabilityConfigChanged` across
   * pods. Called once from `afterPluginsReady`.
   */
  bindConfigChangeEmitter(
    emit: (input: { kind: string; satelliteId?: string }) => void,
  ): void {
    this.emitConfigChanged = emit;
  }

  getHandler(kind: string): SatelliteCapabilityHandler | undefined {
    return this.handlers.get(kind);
  }

  listHandlers(): SatelliteCapabilityHandler[] {
    return [...this.handlers.values()];
  }
}

/**
 * Extension point domain plugins register their capability handlers against.
 * satellite-backend registers the concrete registry as its implementation in
 * `register()` (buffered), so load order does not matter.
 */
export const satelliteCapabilityExtensionPoint =
  createExtensionPoint<SatelliteCapabilityRegistry>("satellite.capability");
