---
title: Satellite telemetry
description: The satellite capability extension point, its protocol envelopes, credit-window backpressure, just-in-time secrets, and binding-based authorization.
---

Satellites relay telemetry for the network zone they run in: they receive logs
and metrics through local receivers and forward them, and they scrape Prometheus
targets the core cannot reach and forward the datapoints. All of this rides the
satellite's single authenticated WebSocket to the core, alongside health-check
dispatch. This page is the developer reference for how that channel is built:
the extension point domain plugins contribute to, the generic protocol envelopes,
the backpressure and secret-delivery mechanics, and the dependency direction that
keeps `satellite-backend` ignorant of every domain plugin. For the wider satellite
protocol (enrollment, assignments, results), see
[Satellites architecture](/checkstack/developer-guide/architecture/satellite/); for
the operator view, see [Satellites](/checkstack/user-guide/concepts/satellites/).

## Dependency direction

`satellite-backend` owns the telemetry channel but must never import a domain
plugin (`logstream-backend`, `metricstream-backend`), per the platform's
[dependency rules](/checkstack/developer-guide/tooling/dependency-linter/).
It inverts the dependency with an extension point: it routes generic envelopes by
a stable `kind` string and lets the owning domain plugin supply the handler for
that kind. `satellite-backend` never learns what a `kind` means.

The agent obeys the same rule. The pure parsers a receiver needs (OTLP logs and
metrics decode, Prometheus text parse, syslog framing, native JSON) were
relocated out of any `*-backend` into leaf packages the agent may import:

- `@checkstack/logstream-common` and `@checkstack/metricstream-common` carry the
  per-domain parsers and normalization.
- `@checkstack/otlp-wire` is a new zero-node-builtin leaf holding the shared OTLP
  wire decode, so both domains and the agent depend on one implementation without
  pulling in a backend.

The result is that `@checkstack/satellite` (the agent) depends only on `*-common`
packages, `otlp-wire`, and `backend-api` - never on a `*-backend`. The same
direction that keeps the core clean keeps the agent shippable.

## The capability extension point

`satellite-backend` defines
[`satelliteCapabilityExtensionPoint`](https://github.com/enyineer/checkstack/blob/main/core/satellite-backend/src/capability-registry.ts).
A domain plugin registers a `SatelliteCapabilityHandler` against it; the platform
buffers registrations, so load order does not matter. The handler is the complete
contract between a domain and the telemetry channel:

```ts
export interface SatelliteCapabilityHandler {
  /** The capability kind this handler owns (e.g. "logstream"). */
  kind: string;

  /**
   * Ingest one forwarded telemetry batch. Return the per-item outcome. Set
   * `retryable: true` for a TRANSIENT failure so the agent resends; omit or
   * `false` for a terminal rejection so the agent drops the batch and counts
   * the loss. A throw is treated as transient (retryable) by the WS handler.
   */
  handleTelemetryBatch?(ctx: {
    satelliteId: string;
    payload: unknown;
    /** Items the satellite dropped from its bounded buffer since the last
     * batch of this kind (a disconnect / slow-consumer episode), keyed by the
     * group the loss belongs to (a domain string the handler interprets - the
     * stream token for the forward paths, the scrape target id for
     * `metric-scrape`) so it is attributed to the exact stream. */
    droppedByGroup?: Record<string, number>;
  }): Promise<{ accepted: number; rejected: number; retryable?: boolean }>;

  /**
   * Build the capability config to push to a satellite (e.g. its bound scrape
   * targets). Called after `authenticated` and on every config-changed notify.
   * Return `null` to push nothing. Secrets MUST NOT ride this config.
   */
  buildCapabilityConfig?(ctx: { satelliteId: string }): Promise<unknown | null>;

  /** Handle a fire-and-forget status update from a satellite (no ack). */
  handleCapabilityStatus?(ctx: {
    satelliteId: string;
    payload: unknown;
  }): Promise<void>;

  /**
   * Resolve a just-in-time secret for a `capability_secret_request`. The
   * handler resolves from ITS OWN durable state and MUST validate that the
   * requested resource is bound to `satelliteId`. Return `{ payload }` with
   * the resolved secret or `{ error }` on a binding/resolution failure.
   * Secrets resolved here MUST NOT be persisted and MUST NOT ride the config.
   */
  resolveSecret?(ctx: {
    satelliteId: string;
    payload: unknown;
  }): Promise<{ payload?: unknown; error?: string }>;
}
```

Every method is optional: a forward-only domain implements
`handleTelemetryBatch`; a scrape domain also implements `buildCapabilityConfig`,
`handleCapabilityStatus`, and `resolveSecret`. The `payload` is opaque to
`satellite-backend` and validated by the handler, which is what lets
`satellite-common` stay a leaf with no dependency on any domain schema.

Domain plugins contribute in their `register()` by resolving the extension point
and registering their handler:

```ts
import { satelliteCapabilityExtensionPoint } from "@checkstack/satellite-backend";

env
  .getExtensionPoint(satelliteCapabilityExtensionPoint)
  .registerCapability(ingest.satelliteCapabilityHandler, pluginMetadata);
```

The registry also exposes `notifyCapabilityConfigChanged({ kind, satelliteId? })`
so a domain plugin can ask the core to rebuild and re-push a kind's
`capability_config` when its underlying data changes (for example after a
scrape-target CRUD mutation). `satellite-backend` fans this out across pods via a
broadcast domain event, so whichever pod holds the socket performs the push.

## Protocol envelopes

The telemetry channel adds generic, additive envelopes to the satellite protocol
in
[`satellite-common/src/protocol.ts`](https://github.com/enyineer/checkstack/blob/main/core/satellite-common/src/protocol.ts).
Each carries a `kind` and an opaque `payload`; the router dispatches on `kind`.

Satellite to core:

| Message | Purpose |
|---------|---------|
| `telemetry_batch` | A batch of normalized items to ingest. Carries `batchId` (monotonic per connection, for dedupe), `kind`, `payload`, and optional `droppedByGroup` (per-group in-transit drop counts, keyed by stream token / scrape target id). |
| `capability_status` | A fire-and-forget status update for a kind (e.g. per-scrape-target `lastScrapeAt` / `lastError`). No ack. |
| `capability_secret_request` | A just-in-time request for a kind's secret (e.g. a scrape target's bearer). Carries `requestId`, `kind`, and an opaque handler-validated `payload` naming the bound resource. |

Core to satellite:

| Message | Purpose |
|---------|---------|
| `telemetry_ack` | Acknowledges a `telemetry_batch` by `batchId`. Carries `accepted`, `rejected`, and `retryable`. Required for every batch. |
| `capability_config` | Pushes a kind's configuration (e.g. the satellite's bound scrape targets). Sent after `authenticated` and on every notify. Opaque `payload`, never secrets. |
| `capability_secret_response` | Replies to a `capability_secret_request` by `requestId`, with a resolved `payload` or an `error`. |

The satellite advertises its capabilities on the `authenticate` message (and
re-advertises on `heartbeat` so a config change converges without a reconnect) as
a `capabilities: string[]`. Both fields are optional for version-skew safety: an
older agent omits them and the core treats it as no advertised capabilities.

## Credit window and backpressure

Forwarding is paced so a burst inside a zone cannot overrun the core or the
satellite's memory:

- The agent buffers telemetry per kind in **bounded, drop-oldest** in-memory
  buffers, bucketed by the loss-attribution group (the stream token, or the
  scrape target id). When a buffer is full, the oldest items are dropped and
  counted against the group they belonged to.
- A **credit window** limits in-flight batches. The agent holds each
  `telemetry_batch` inflight until the core replies with its `telemetry_ack`, so
  it cannot outrun a slow consumer.
- The ack's `retryable` flag decides the agent's next move. `true` (a transient
  failure: over-budget, sink hiccup, no handler registered yet) means keep the
  batch and resend under the same `batchId`. `false` (a terminal rejection:
  auth-rejected) means drop the batch. The rejected count is a **core-side**
  outcome the core attributes per stream itself - the agent does NOT re-count it
  as an in-transit drop, which would double-count it and, for a bad token,
  misattribute the loss to unrelated streams. A throw inside
  `handleTelemetryBatch` is treated as transient.

The count of items a satellite dropped from its buffer during a disconnect or
slow-consumer episode rides the next batch of that kind as `droppedByGroup`,
keyed by the group (stream token / scrape target id) each dropped item belonged
to. The handler resolves each group key to its stream and charges that stream
alone, so the loss lands on the exact stream that lost data rather than being
spread across every stream in the batch. The log-stream and metric-stream
overview pages render the total as **Dropped in transit**, distinct from any
core-side drop. A drop whose group key no longer resolves to a stream (an
unknown or revoked token, an unbound target) is left unattributed rather than
charged to another stream.

## Just-in-time secret channel

Authenticated scrape targets need a bearer token, but a secret must never be
persisted on a satellite nor pushed in a config that re-crosses the wire on every
reconnect. The capability secret channel is the generic analogue of the
health-check run-secret path:

1. `buildCapabilityConfig` pushes the scrape config with only an advisory
   `hasBearer` flag - never the token.
2. Just before a scrape, the agent sends a `capability_secret_request` naming the
   bound resource (for example `{ targetId }`).
3. The core routes it to the handler's `resolveSecret`, which resolves the secret
   from its own durable state and validates the binding, then replies with
   `capability_secret_response` carrying `{ bearerToken }` or an `error`.
4. The agent holds the value in memory only for that poll and never writes it to
   disk. On `error` it skips the poll and reports the failure via
   `capability_status`.

The satellite names a resource it is bound to; it never chooses an arbitrary
secret. The binding is the authorization boundary.

## Binding-based authorization

The two forwarding shapes are authorized by different proofs, and neither trusts
the satellite to mint authority of its own:

- **Receiver forwarding is authorized by the stream token.** The shipper hands
  the satellite the same per-stream source token it would send to the HTTP push
  endpoint (`ckls_` for logs, `ckms_` for metrics). The satellite forwards it
  unchanged, and the domain handler verifies it exactly as the direct HTTP push
  does, honoring revocation. The satellite is a relay on the same authorization
  path, not a new trust boundary.
- **Scraping is authorized by the target binding.** The handler's
  `handleTelemetryBatch` (and `resolveSecret`) accept a datapoint or a secret
  only for a target whose bound `satelliteId` matches the sending satellite, so a
  satellite cannot forward metrics for a target it was never bound to. Binding a
  target to a satellite in the UI requires the operator to have read access to
  that satellite and the satellite to advertise `scrape`.

## Agent scraper egress guard

The agent's scraper applies the **same SSRF guard the core uses** before it
fetches an exporter: it resolves and validates the host with
`resolveAndValidateHost` against `DEFAULT_EGRESS_DENY_CIDRS`, enforces a scheme
guard, caps the response size, and applies a timeout. Cloud-metadata and
link-local addresses are refused; reaching internal exporters on the zone's
private network is allowed by design, which is the whole point of scraping from
inside the zone. Moving the scrape to the satellite does not relax the guard.

## See also

- [Satellites architecture](/checkstack/developer-guide/architecture/satellite/) -
  enrollment, assignment dispatch, and the result contract.
- [Satellites](/checkstack/user-guide/concepts/satellites/) - the operator model.
- [Ship logs to a stream](/checkstack/user-guide/guides/ship-logs/) and
  [Ship metrics to a stream](/checkstack/user-guide/guides/ship-metrics/) - the
  shipper-facing guides.
