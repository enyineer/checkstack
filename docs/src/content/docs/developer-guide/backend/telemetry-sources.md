---
title: "Telemetry sources and sinks"
description: "The platform-level abstraction for pluggable telemetry ingestion: contribute source types that emit logs, metrics or traces into bound streams."
---

The `telemetry` platform plugin owns a signal-agnostic source/sink abstraction. It exists so that applications which cannot ship OpenTelemetry exporters still feed the observability stack: any plugin can contribute a **source type** (a poller, a vendor webhook) that emits **normalized records** for one or more **signals** (`logs`, `metrics`, `traces`), and users configure **source instances** that route those signals into concrete streams.

> [!NOTE]
> Token-authenticated push endpoints (OTLP and native ingest on logstream, metricstream, and tracestream) ARE part of this abstraction: they are a `push` source mode. The owning plugin still serves its own inbound route, but the per-source bearer token is minted, hashed, and rotated by the platform, and the endpoint verifies it through the platform's push-token service (see [Push sources](#push-sources)). The telemetry platform covers *configured* ingestion: anything with credentials, a schedule, or a minted endpoint.

## Architecture

```text
core/telemetry-common    → signal model, normalized record schemas, source instance
                           schemas, RPC contract, access rules, SourceConfigSlot
core/telemetry-backend   → telemetrySourceExtensionPoint + telemetrySinkExtensionPoint,
                           source instance storage/service/router, pull reconciler,
                           webhook mounting, config-secret channel, guarded fetch
core/telemetry-frontend  → StreamSourcesSection (embedded by stream frontends),
                           source catalog + schema-driven config dialogs
```

Dependency direction is doubly inverted, so the platform imports no stream plugin:

- **Sinks**: the plugin that owns a signal's streams (logstream, metricstream, tracestream) registers one sink per signal. A sink adapts normalized records into the plugin's own ingest pipeline and answers "may this caller bind stream X?" through its own access rules.
- **Source types**: any plugin registers ways telemetry enters the platform. The platform validates the instance config, resolves secrets, schedules pulls, verifies webhook secrets, and routes emitted records to the bound streams through the sinks.

## Normalized records

Records are OTel-shaped in-process structures (not a wire format), defined in `@checkstack/telemetry-common`. A syslog line, a CloudWatch poll result and an OTLP export all become the same normalized shape before a sink applies the stream's own policy (severity rules, sampling, caps). Correlation keys (`traceId`, `spanId`, `resource.serviceName`) survive no matter how the telemetry was produced.

## Contributing a source type

```ts
import {
  defineTelemetrySourceType,
  telemetrySourceExtensionPoint,
} from "@checkstack/telemetry-backend";
import { configString } from "@checkstack/backend-api";
import { z } from "zod";

const cloudwatchSource = defineTelemetrySourceType({
  id: "cloudwatch",
  displayName: "AWS CloudWatch",
  description: "Polls CloudWatch log groups and metric namespaces",
  icon: "Cloud",
  signals: ["logs", "metrics"],
  configSchema: z.object({
    region: z.string(),
    logGroup: z.string().optional(),
    // Marked x-secret: encrypted at rest, masked in the editor, never read back.
    secretAccessKey: configString({ "x-secret": true }),
  }),
  pull: {
    defaultIntervalSeconds: 60,
    minIntervalSeconds: 30,
    async execute({ config, sink, fetch, logger, abortSignal }) {
      const records = await pollCloudwatch({ config, fetch, abortSignal });
      await sink.emit("logs", records.logs);
      await sink.emit("metrics", records.metrics);
    },
  },
});

// In the plugin's register():
env
  .getExtensionPoint(telemetrySourceExtensionPoint)
  .registerSourceType(cloudwatchSource, pluginMetadata);
```

A source type implements at least one of five seams:

- `pull`: the platform's reconciler schedules one recurring run per enabled instance (any pod may claim it), with an `abortSignal` timeout. A pull type may also declare `supportsSatellite: true` to run at the edge (see [satellite execution](#satellite-execution)).
- `webhook`: the instance gets a minted endpoint under `/api/telemetry/hooks/<sourceId>`; the platform verifies the delivery and applies a per-instance rate limit before `webhook.handle` is invoked. By default it checks the per-instance secret (hash-only storage, shown once, rotatable) presented as a bearer token, the `X-Checkstack-Webhook-Secret` header, or a `?secret=` query param. A type that receives deliveries from a real vendor which SIGNS the payload (GitHub, Slack) instead declares a `webhook.signature` descriptor, and the platform verifies the vendor HMAC signature over the raw body rather than expecting the plain secret. See [webhook signature verification](#webhook-signature-verification).
- `push`: the OWNING plugin serves an inbound endpoint (OTLP, a native ingest route) and shippers authenticate with a per-source bearer token the PLATFORM mints and hashes. The plugin verifies presented tokens through the platform's push-token service. See [push sources](#push-sources).
- `listener`: a long-lived inbound socket (syslog-style). `start(ctx)` returns a stop function; the platform starts enabled instances on every pod, converges start/stop/restart across pods on config changes, and stops them on shutdown. See [listener sources](#listener-sources).
- `derive`: a signal-to-signal transform that reads one stream and emits another (log-to-metric, log-to-trace). It runs as a best-effort tap after the input stream's flush commits and can never affect ingest. See [derive sources](#derive-sources).

Rules the platform enforces for you:

- `ctx.config` is always validated against `configSchema` before a seam runs; secrets are resolved just-in-time from encrypted storage. A config schema whose `x-secret` fields are nested or reject the platform's storage markers fails at boot, not at run time.
- `ctx.fetch` (pull seam) is SSRF-guarded. Use it for every config-derived URL; the global `fetch` is not guarded.
- An instance may bind a subset of `signals`; `sink.emit` for an unbound signal is a counted no-op (`bound: false`).

## Push sources

A `push` source type keeps its own inbound endpoint - the OWNING plugin serves OTLP and native ingest routes - but delegates authentication to the platform. Declaring the seam is enough to make any plugin a push-source contributor; the built-in stream plugins (logstream, metricstream, tracestream) are ordinary consumers of the same seam a third-party push type uses.

```ts
const otlpMetrics = defineTelemetrySourceType({
  id: "push",
  displayName: "Push (OTLP / native)",
  description: "Ship metrics over OTLP/HTTP or the native JSON endpoint",
  icon: "Upload",
  signals: ["metrics"],
  // Empty config: the platform Sources section is the only ingest surface.
  configSchema: z.object({}),
  push: {
    // Stable per type; the only routing hint a raw token exposes. Existing
    // shippers keep their historical prefix across the platform migration.
    tokenPrefix: "ckms_",
    // Inbound endpoints the UI renders setup snippets for (OTel Collector YAML
    // for `otlp`, a curl example for `native`).
    endpoints: [
      { kind: "otlp", path: "/api/metricstream/v1/metrics", label: "OTLP metrics" },
      { kind: "native", path: "/api/metricstream/ingest", label: "Native JSON" },
    ],
  },
});
```

### What the platform owns

Creating an instance MINTS the bearer token: the platform stores only its sha256 hash (`telemetry_sources.push_token_hash`, indexed) and returns the raw token ONCE (`createSource`'s `push: PushInfo`). `rotatePushToken` mints a replacement and drops the old hash. Tokens are SCOPED to their source TYPE: a token minted for one push type never verifies for another (the lookup rejects a hash whose row is a different `sourceTypeId`).

### Verifying a presented token

The endpoint owner turns a presented token into an authorization verdict WITHOUT depending on the platform's schema. Inject the cross-plugin verifier through `telemetryPushTokenVerifierRef`, wrap it with `createPushTokenLookup({ verifier, sourceTypeId, signal })`, and feed that to the shared `createIngestAuthenticator` - the same cached, negative-cache-protected verification the plugins already use for their own native source tokens:

```ts
import {
  telemetryPushTokenVerifierRef,
  createPushTokenLookup,
} from "@checkstack/telemetry-backend";
import { createIngestAuthenticator } from "@checkstack/ingest-utils";

const verifier = env.getService(telemetryPushTokenVerifierRef);

const authenticator = createIngestAuthenticator({
  lookup: createPushTokenLookup({
    verifier,
    sourceTypeId: "metricstream.push",
    signal: "metrics",
  }),
  cache,
  hashToken,
});

// On each delivery: verify, resolve the bound stream, then record activity.
const verdict = await authenticator.authenticate(presentedToken);
if (verdict.ok) {
  await ingest({ streamId: verdict.resourceId, records });
  void verifier.recordPushSeen(verdict.tokenId); // throttled lastRunAt stamp
}
```

Verdicts follow the lookup: an unknown hash (or a token of a different push type) reads as `unknown` and is negatively cached; a real token whose instance is disabled OR that has no binding for this `signal` reads as `revoked` (deliberately not `unknown`, so a real token never poisons the negative cache); an enabled instance with a binding for the signal yields `{ ok: true, resourceId: <bound stream id> }`. `recordPushSeen` stamps `lastRunAt` at most once per `PUSH_SEEN_STAMP_THROTTLE_MS` (60s) per source per pod, which is what the frontend renders as the "last received" liveness hint.

### Cache convergence across pods

Because every pod caches verification verdicts, a mint, rotation, delete, or enable/disable must converge all of them. The platform emits the `telemetry.push-token.invalidated` hook for each affected hash:

```ts
interface TelemetryPushTokenInvalidatedPayload {
  sourceTypeId: string;
  sourceId: string;
  tokenHash: string; // sha256 hex; never the token itself
  reason: "minted" | "revoked";
}
```

A rotation emits two events (one `revoked` for the old hash, one `minted` for the new); delete and disable emit `revoked`; create and enable emit `minted`. Each endpoint-owning plugin subscribes in BROADCAST mode, filters on its own `sourceTypeId`s, and applies the verdict to its `IngestAuthenticator` caches: a shared positive-key delete plus miss-marker delete on `revoked`, and `clearNegative` on `minted` (so a freshly minted token is not shadowed by a pod's negative LRU for its TTL). Delivery is at-least-once; the 60s positive-cache TTL bounds the stale window if a `revoked` event is ever lost.

## Webhook signature verification

Many vendors never send a plain shared secret. They SIGN each delivery with an HMAC computed from the shared secret and put the signature in a header. A webhook source type opts into uniform, platform-level signature verification by adding a `signature` descriptor to its `webhook` seam. When present, the platform verifies the HMAC before `webhook.handle` runs and never expects the plain secret.

```ts
// GitHub: HMAC-SHA256, hex, "sha256=" prefix, over the raw body.
webhook: {
  handle: async (ctx, request) => { /* parse + emit */ },
  signature: {
    algorithm: "hmac-sha256",
    header: "x-hub-signature-256",
    encoding: "hex",
    prefix: "sha256=",
    basestring: "body",
  },
},
```

```ts
// Slack: HMAC-SHA256, hex, "v0=" prefix, over `v0:<timestamp>:<body>`.
signature: {
  algorithm: "hmac-sha256",
  header: "x-slack-signature",
  encoding: "hex",
  prefix: "v0=",
  basestring: "versioned-timestamp-body",
  timestampHeader: "x-slack-request-timestamp",
  toleranceSeconds: 300,
},
```

Descriptor fields:

- `algorithm`: `hmac-sha256` or `hmac-sha1`.
- `header`: the header carrying the signature.
- `encoding`: `hex` or `base64`, how the signature bytes are encoded in the header.
- `prefix`: a literal prefix stripped before the compare (for example `sha256=`, `v0=`). Required for the versioned base string, where it doubles as the signed version.
- `basestring`: `body` signs the raw request body. `versioned-timestamp-body` signs `<version>:<timestamp>:<body>` (the Slack v0 scheme), where `version` is the prefix without its trailing `=`.
- `timestampHeader` and `toleranceSeconds`: required for `versioned-timestamp-body`. The platform rejects a delivery whose timestamp is more than `toleranceSeconds` away from now (replay protection).

The descriptor is validated at source-type registration: a `versioned-timestamp-body` descriptor missing `timestampHeader`, `toleranceSeconds`, or `prefix` fails at boot with the offending type named.

Because the HMAC is computed from the shared secret, the platform stores the raw webhook secret encrypted at rest (in addition to the hash) for signature-verifying types only, and rotates that stored copy when the secret is rotated so signatures minted from the old secret stop verifying. Plain-secret types keep hash-only storage.

> [!IMPORTANT]
> Adding a `signature` descriptor to an ALREADY-SHIPPED source type requires rotating each existing instance's webhook secret. The platform stores the raw secret needed for HMAC verification only from a rotation onward, so instances created before the type declared a signature have no stored key, and the plaintext cannot be recovered from the hash. Until you rotate, those instances fail closed: every delivery is rejected with 401, the instance records a "webhook signature verification unavailable" health error, and the log warns once per source with the remedy. Rotating the webhook secret stores the raw key and restores verification.

> [!NOTE]
> Stripe does not fit the single-header descriptor: it packs several comma-joined `k=v` pairs into one `Stripe-Signature` header (`t=<ts>,v1=<hex>`), which no `header` plus `prefix` scheme can address. A Stripe source type verifies inside its own `handle()` instead of declaring a `signature`.

## Listener sources

A `listener` source type holds a long-lived inbound socket that is pod-local infrastructure. `start(ctx)` receives `{ config, sink, logger }` and returns a stop function; the pod-local listener manager (`core/telemetry-backend/src/listeners.ts`) starts one listener per enabled instance ON EVERY POD, converges start/stop/restart across pods through the source-changed broadcast hook, and stops them on shutdown. Whether all those binds succeed depends on topology: with per-pod network namespaces (Kubernetes) every pod binds and a Service/load balancer distributes connections; on a shared host network the first pod wins and the others fail with `EADDRINUSE`, which is recorded as the instance's `lastError` rather than crashing boot - expected for a single-bind listener.

The reference implementation is the **syslog** source type (`logstream.syslog`, `core/logstream-backend/src/ingest/syslog/source-type.ts`). It receives RFC 5424 over TCP (optionally TLS) via `Bun.listen`, frames RFC 6587 octet-counting or LF delimiting, parses each line, and emits normalized log records through the bound sink. Its config carries `port`, `host`, `maxConnections`, and an optional `tls: { certPath, keyPath }` - TLS is configured with file paths, not inline PEM, because the inline-secret channel forbids nested secret fields and infrastructure mounts TLS material as volumes anyway.

> [!IMPORTANT]
> The core listener does NO per-message token handling. The instance BINDING is the authorization and routing: every line on the socket goes to the bound stream. This differs from the satellite syslog receiver, which keeps an in-message `ckls_` token protocol because it forwards to the core's stream-token-authorized push path. See [satellite telemetry](/checkstack/developer-guide/backend/satellite-telemetry/).

## Derive sources

A `derive` source type transforms one signal into another. Its seam is `derive: { fromSignal, getInputStreamId, process }`: `fromSignal` is the signal it CONSUMES (distinct from `signals`, which it EMITS), `getInputStreamId(config)` resolves the input stream id from validated config, and `process` folds the flushed records into output records emitted through the bound sink. The INPUT stream is named in config; the OUTPUT streams come from the instance's bindings.

Derivation is a **post-flush tap**: the dispatcher (`core/telemetry-backend/src/derive.ts`) runs `process` only AFTER the input stream's flush has committed, and the tap is fully error-isolated - a deriver throw is caught and recorded as the instance's `lastError`, and can never break or slow the source stream's ingest. The tap is a no-op until connected and skips empty batches.

Two built-ins ship from inside the platform (registered through the same source extension point):

- **log-to-metric** (`telemetry.log-to-metric`, `core/telemetry-backend/src/derive-sources/log-to-metric.ts`): `fromSignal: "logs"`, `signals: ["metrics"]`. Folds matching log lines into counter-delta or gauge metric points (a `count` mode or an `extractNumber` mode).
- **log-to-trace** (`telemetry.log-to-trace`, `core/telemetry-backend/src/derive-sources/log-to-trace.ts`): `fromSignal: "logs"`, `signals: ["traces"]`. Synthesizes `internal` spans from logs that carry a valid W3C trace id and span id.

## Reference source types

The two satellite-capable pull types below are the reference implementations for the pull seam plus `supportsSatellite`:

- **Prometheus scrape** (`metricstream.prometheus-scrape`, `core/metricstream-backend/src/sources/prometheus/source-type.ts`): `signals: ["metrics"]`, `supportsSatellite: true`, pull `defaultIntervalSeconds: 60` / `minIntervalSeconds: 5`. Config is `{ url, timeoutMs, bearerToken? }` (the bearer is `x-secret`). It polls a Prometheus text-exposition endpoint and routes the parsed series into the bound metric stream. This is also the migration target for the removed metricstream scrape-target feature (see [metric streams backend](/checkstack/developer-guide/backend/metricstream/)).
- **Kubernetes events** (`k8s-events.k8s-events`, `plugins/k8s-events-backend/src/source-type.ts`): `signals: ["logs"]`, `supportsSatellite: true`, pull `defaultIntervalSeconds: 60` / `minIntervalSeconds: 15`. Config carries `apiServerUrl` (https only), `bearerToken` (`x-secret`), optional `namespace` / `fieldSelector` / `labelSelector`, `maxEventsPerPull` (default 500), and `lookbackSeconds` (default 90). It LISTs `events.k8s.io/v1` events on the interval with `Authorization: Bearer`, maps `type: "Warning"` events to WARN severity (everything else to INFO), and emits them as log records. The pull is CURSORLESS: "new since last pull" is approximated by a wall-clock window `now - lookbackSeconds`, so `lookbackSeconds` should sit slightly ABOVE the pull interval - the overlap re-emits (duplicate-tolerant), a shorter window drops. `maxEventsPerPull` caps the number of EMITTED (in-window) records, NOT scanned items: the Kubernetes list API returns events roughly oldest-first with no server-side time filter, so the pull pages past out-of-window backlog until it has that many in-window records. The SCAN itself is hard-bounded at 40 pages (`K8S_EVENTS_MAX_PAGES` x 500 = 20k items); on a cluster busy enough to exhaust that budget the pull emits a partial window and logs a warning recommending a `namespace` / `fieldSelector` to narrow the stream. Each record carries a stable `k8s.event.uid` for downstream dedup.

## Contributing a sink (signal owners only)

```ts
import { telemetrySinkExtensionPoint } from "@checkstack/telemetry-backend";

env.getExtensionPoint(telemetrySinkExtensionPoint).registerSink(
  {
    signal: "logs",
    assertBindable: async ({ streamId, user }) => {
      // Throw FORBIDDEN unless `user` may MANAGE the stream (global rule or
      // team grant). The check lives HERE because only the owning plugin
      // knows its access rules.
    },
    describeStream: async ({ streamId }) => lookupIdAndName(streamId),
    // OPTIONAL: back the binding editor's per-signal picker. List every stream
    // (id + name), then FILTER to the ones `user` may manage - reuse the same
    // rule as assertBindable. Omit it and the picker for this signal is empty.
    listBindableStreams: async ({ user }) => listManageableStreams(user),
    write: async ({ streamId, records, source, now }) =>
      pipeline.ingest({ streamId, lines: mapToIngestedLines(records), now }),
  },
  pluginMetadata,
);
```

A sink's `write` runs on machine paths with no user context: authorization happened at bind time, exactly like a source token pre-authorizes a push endpoint. Apply the same normalization the plugin's own endpoints apply, so records behave identically regardless of the entry path.

Both logstream and metricstream build `assertBindable` / `describeStream` / `listBindableStreams` from the shared `createStreamBindAuthorizer` factory in `telemetry-backend/src/sink-guards.ts`, so the manage-on-stream rule (service bypass, global rule, then a per-resource team-grant filter via `auth.listAccessibleObjectIds`) lives in ONE place and the two sinks cannot drift.

## Source instances and RLAC

Source instances are their own team-scopable resource (`telemetry.source`). Creating or re-binding an instance additionally requires manage on every bound stream, enforced through `assertBindable`. Secrets in the instance config are stored via the platform's internal secrets service and read back omitted, with `storedSecretFields` driving the editor's keep-existing semantics.

## Frontend embedding

Stream frontends embed the platform's section component instead of building their own source UI:

```tsx
import { StreamSourcesSection } from "@checkstack/telemetry-frontend";

<StreamSourcesSection signal="metrics" streamId={stream.id} />
```

The section self-hides while no source types exist for the signal, so streams show no empty shell on installations without source plugins. A source plugin can replace the generic schema-driven config form with a bespoke editor by filling `SourceConfigSlot` for its `sourceTypeId`.

The add/edit dialogs drive routing through a **multi-signal binding editor**: one stream picker per signal the selected type emits, each fed by `listBindableStreams({ signal })` (the streams the caller may manage). A signal can be left unrouted as long as one binding remains. When opened from a stream section, the embedding stream presets the matching signal; a single-signal type opened this way collapses to that preset with no extra interaction. Editing keeps a bound-but-no-longer-listable stream visible as a synthetic option so a save never silently drops it.

A global **Sources page** (`telemetryRoutes.routes.sources`, under the Reliability nav group) lists every source instance the caller may read, across all streams and signals, with per-row enable/edit/rotate/delete gated on the caller's manage grant. Its "Add source" opens the full catalog with no preset binding. The read DTO carries `bindingStreamNames` - the target stream's display name per signal, resolved by the owning sinks in one batched `describeStreams` lookup per signal (a sink without the batch method falls back to grouped per-id `describeStream`). The routing column shows that name next to each signal badge, falling back to the stream id in the tooltip when a stream no longer resolves.

## Satellite execution

Pull-mode types can declare `supportsSatellite: true`, and a source instance can then bind a `satelliteId` to execute at the edge instead of on core. The platform owns a generic `telemetry-pull` satellite capability (`core/telemetry-backend/src/satellite/pull-capability.ts`): per-satellite config push (secrets never ride the config - the agent fetches them just-in-time per field over the authenticated socket), binding-authorized batch re-ingestion through the same sinks, per-instance status mirroring, and an authorship guard (`assertSatellitePullBindable`, `core/telemetry-backend/src/satellite/binding-auth.ts`) that stops a stream manager from binding a source to a satellite they cannot READ. For the channel mechanics see [satellite telemetry](/checkstack/developer-guide/backend/satellite-telemetry/).

One constraint is inherent to satellites: the agent only runs code statically compiled into the satellite build. A satellite-capable source type therefore ships a pure `SatellitePullExecutor` (`@checkstack/telemetry-common`) whose parsing logic lives in a browser-safe `*-common` leaf, and the executor is registered in the agent's executor registry (`core/satellite/src/telemetry/pull/executors.ts`, `registerBuiltinPullExecutors`) keyed by the qualified source type id. Config pushed for a source type with no registered executor produces a per-instance status error on the satellite, never a crash. Both built-in executors (Prometheus scrape, Kubernetes events) live in `core/satellite/src/telemetry/pull/` because they wrap the SSRF egress guard from `@checkstack/backend-api`, which a `*-common` leaf must not import; each reuses its pure parsing and mapping driver from the owning `*-common` package (`metricstream-common`'s text parser and shaping, `k8s-events-common`'s list-and-map driver), so core and agent share one implementation.
