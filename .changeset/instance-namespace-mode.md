---
"@checkstack/backend-api": minor
"@checkstack/backend": minor
"@checkstack/frontend-api": minor
"@checkstack/frontend": minor
"@checkstack/queue-bullmq-backend": minor
---

Add an instance-namespace runtime mode so a secondary backend instance can run
alongside the default one on shared external infrastructure without colliding.

- `@checkstack/backend-api` now exposes `coreServices.instanceRuntime`
  (`InstanceRuntime { namespace, isDefault }`) plus `parseInstanceNamespace` /
  `createInstanceRuntime` / `instanceNamespaceSchema`. The core backend reads
  `CHECKSTACK_INSTANCE_NAMESPACE` at boot (validated, failing fast on a bad
  value), registers the service, and advertises a non-empty namespace on
  `/api/config`.
- Plugin-author contract: a plugin that keeps state on infrastructure SHARED
  across instances (redis key space, shared cache prefix, consumer group, topic)
  MUST fold `instanceRuntime.namespace` into that key/name. Namespace rather than
  suppress: user-visible behaviour keeps running in a secondary instance, only
  the shared keys change. See the new "Parallel instances and namespacing"
  developer-guide page.
- `@checkstack/queue-bullmq-backend` is the reference implementation: it folds
  the namespace into the effective redis key prefix (`checkstack:` becomes
  `checkstack:preview:` under the `preview` namespace), isolating queues, jobs,
  schedulers and consumer groups. The default instance's prefix is byte-for-byte
  unchanged.
- The admin frontend shows a slim "preview instance" banner when the runtime
  config carries a non-empty `instanceNamespace`.
