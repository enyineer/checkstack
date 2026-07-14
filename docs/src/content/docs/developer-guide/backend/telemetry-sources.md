---
title: "Telemetry sources and sinks"
description: "The platform-level abstraction for pluggable telemetry ingestion: contribute source types that emit logs, metrics or traces into bound streams."
---

The `telemetry` platform plugin owns a signal-agnostic source/sink abstraction. It exists so that applications which cannot ship OpenTelemetry exporters still feed the observability stack: any plugin can contribute a **source type** (a poller, a vendor webhook) that emits **normalized records** for one or more **signals** (`logs`, `metrics`, `traces`), and users configure **source instances** that route those signals into concrete streams.

> [!NOTE]
> The plugins' token-authenticated push endpoints (OTLP and native ingest on logstream and metricstream) are NOT part of this abstraction and stay per plugin, with per-stream tokens that rotate independently. The telemetry platform covers *configured* ingestion: anything with credentials, a schedule, or a minted endpoint.

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

A source type implements at least one of three seams:

- `pull`: the platform's reconciler schedules one recurring run per enabled instance (any pod may claim it), with an `abortSignal` timeout.
- `webhook`: the instance gets a minted endpoint under `/api/telemetry/hooks/<sourceId>`; the platform verifies the delivery and applies a per-instance rate limit before `webhook.handle` is invoked. By default it checks the per-instance secret (hash-only storage, shown once, rotatable) presented as a bearer token, the `X-Checkstack-Webhook-Secret` header, or a `?secret=` query param. A type that receives deliveries from a real vendor which SIGNS the payload (GitHub, Slack) instead declares a `webhook.signature` descriptor, and the platform verifies the vendor HMAC signature over the raw body rather than expecting the plain secret. See [webhook signature verification](#webhook-signature-verification).
- `listener`: a long-lived inbound socket (syslog-style). `start(ctx)` returns a stop function; the platform starts enabled instances on every pod, converges start/stop/restart across pods on config changes, and stops them on shutdown.

Rules the platform enforces for you:

- `ctx.config` is always validated against `configSchema` before a seam runs; secrets are resolved just-in-time from encrypted storage. A config schema whose `x-secret` fields are nested or reject the platform's storage markers fails at boot, not at run time.
- `ctx.fetch` (pull seam) is SSRF-guarded. Use it for every config-derived URL; the global `fetch` is not guarded.
- An instance may bind a subset of `signals`; `sink.emit` for an unbound signal is a counted no-op (`bound: false`).

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

Pull-mode types can declare `supportsSatellite: true`, and a source instance can then bind a `satelliteId` to execute at the edge instead of on core. The platform ships the full `telemetry-pull` satellite capability: per-satellite config push (secrets never ride the config - the agent fetches them just-in-time per field over the authenticated socket), binding-authorized batch re-ingestion through the same sinks, per-instance status mirroring, and an authorship guard that stops a stream manager from binding a source to a satellite they cannot read.

One constraint is inherent to satellites: the agent only runs code statically compiled into the satellite build. A satellite-capable source type therefore ships a pure `SatellitePullExecutor` (from `@checkstack/telemetry-common`) in a browser-safe `*-common` package that `core/satellite` imports, and registers it in the agent's executor registry keyed by the qualified source type id. Config pushed for a source type with no registered executor produces a per-instance status error on the satellite, never a crash. This mirrors exactly how the Prometheus scrape capability runs its parsing from `@checkstack/metricstream-common`.
