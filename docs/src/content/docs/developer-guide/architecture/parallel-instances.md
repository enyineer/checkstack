---
title: "Parallel instances and namespacing"
description: "Run a secondary backend instance alongside the default one on shared infrastructure by namespacing every shared-infra resource."
---

Checkstack can run more than one backend instance at once against the SAME external infrastructure. The normal case is horizontal scale: N identical pods sharing one database and one redis, all part of the same logical instance. A second case is a SECONDARY instance: a separate backend, with its own database, that shares the primary's redis (and any future shared cache/topic) but must stay isolated from it. The PR-preview tool boots exactly such a secondary instance next to your dev instance.

This page defines the plugin-author contract that makes secondary instances safe: namespace every resource you keep on shared infrastructure so two instances cannot collide.

## The instance namespace

Each backend runs under an instance NAMESPACE, read once at boot from the `CHECKSTACK_INSTANCE_NAMESPACE` environment variable:

- Unset / blank yields the default instance, whose namespace is the empty string `""`. Existing deployments are unchanged.
- A non-empty value marks a secondary instance. It must be a short, key-safe slug (`/^[a-z0-9][a-z0-9-]{0,31}$/`); an invalid value fails fast at boot.

The namespace is surfaced to every plugin - core and runtime-installed - through `coreServices.instanceRuntime`:

```ts
import { coreServices, type InstanceRuntime } from "@checkstack/backend-api";

env.registerInit({
  deps: { instanceRuntime: coreServices.instanceRuntime },
  init: async ({ instanceRuntime }) => {
    instanceRuntime.namespace; // "" on the default instance, a slug otherwise
    instanceRuntime.isDefault; // true on the default instance
  },
});
```

It is also advertised to the frontend on `/api/config` (as `instanceNamespace`) so the admin SPA renders a "preview instance" banner when the value is present.

## The contract: namespace, do not suppress

If your plugin stores state on infrastructure SHARED across instances - a redis key space, a message topic, a consumer group, a shared cache - you MUST fold `instanceRuntime.namespace` into the key or name you use, so a secondary instance cannot collide with, or read, the default instance's state.

> [!IMPORTANT]
> Namespace rather than suppress. A secondary instance keeps all user-visible
> behaviour running - notifications, integrations, AI, health-check probes - so
> that those surfaces are actually testable in a preview. Only the shared KEYS
> change, never the behaviour.

Two things need NO namespacing:

- Anything backed by the instance's own Postgres database. A secondary instance runs against its own (copied) database, so its rows are already isolated.
- Inbound-only or pull-only integrations. Satellites dial the instance's `BASE_URL` (inbound), and GitOps providers poll remotes read-only (pull), so neither clashes between instances.

Fall back or pause ONLY where namespacing is genuinely impossible - for example a resource that is exclusive on a remote you do not key (a fixed remote git branch you would push to). When you must, make it visible (log + surface), and treat it as the rare exception, not the default.

## Reference implementation: BullMQ key prefix

`plugins/queue-bullmq-backend` is the canonical example. Every BullMQ key derives from the configured key prefix (`${prefix}:${queueName}:...`), so folding the namespace into the prefix namespaces the entire redis key space the instance touches - queues, jobs, schedulers, and consumer groups alike. The redis connection config (host/port/db) is untouched, so the real queue keeps running in a secondary instance.

```ts
export function composeEffectiveKeyPrefix({
  keyPrefix,
  namespace,
}: {
  keyPrefix: string;
  namespace: string;
}): string {
  if (namespace === "") return keyPrefix; // default instance: verbatim
  const base = keyPrefix.endsWith(":") ? keyPrefix.slice(0, -1) : keyPrefix;
  return `${base}:${namespace}:`; // e.g. "checkstack:" -> "checkstack:preview:"
}
```

The plugin resolves `coreServices.instanceRuntime` at init and composes the effective prefix per queue. See [queue-system](/checkstack/developer-guide/backend/queue-system/) for the queue contract itself.

## Cache providers

The default cache is the in-process memory provider, which is per-process and therefore already isolated between instances - no namespacing needed. A SHARED cache provider (e.g. a future redis-backed cache) MUST namespace its keys exactly as BullMQ does: fold `instanceRuntime.namespace` into the key prefix its provider builds. See [cache-system](/checkstack/developer-guide/backend/cache-system/).

## Checklist for a new shared-infra plugin

1. Resolve `coreServices.instanceRuntime` in `registerInit`'s `deps`.
2. Fold `instanceRuntime.namespace` into every key/name you place on shared infrastructure (prefixes, topics, consumer groups).
3. Leave default-instance behaviour byte-for-byte unchanged when the namespace is empty.
4. Keep user-visible behaviour running; only the shared keys change.
5. If a resource genuinely cannot be namespaced, pause it under a non-default namespace and surface that clearly.
