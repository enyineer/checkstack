---
"@checkstack/gitops-common": minor
"@checkstack/gitops-backend": minor
"@checkstack/automation-backend": minor
---

Surface per-variant config documentation for the `Automation` GitOps kind.

The GitOps editor and Kind Registry Browser now show the right config schema
for each automation trigger and provider action when authoring an
`Automation` YAML, mirroring how the `Healthcheck` kind documents its
strategy/collector configs:

- `triggers[].config` — one entry per registered trigger that declares a
  `configSchema`, conditioned on the chosen `triggers[].event`.
- `actions[].config` — one entry per registered provider action,
  conditioned on the chosen `actions[].action`.

New plugin-author contract on the entity kind registry:

- `@checkstack/gitops-common` / `@checkstack/gitops-backend`: add
  `EntityKindRegistry.registerSpecSchemaDocumentationProvider(provider)`. The
  provider is a thunk invoked on every `describeKinds()` (i.e. each time the
  kind-browser RPC is queried), so the docs it returns reflect the current
  state of whatever it reads — order-independent.

Why a lazy provider (and not the existing eager
`registerSpecSchemaDocumentation`): unlike Healthcheck, whose
strategy/collector registries are core services fully populated before any
plugin's `afterPluginsReady`, the automation trigger/action registries are
filled by other plugins across their `init` / `afterPluginsReady` phases with
no guaranteed ordering. Several plugins (catalog/maintenance/notification)
register their provider actions in their own `afterPluginsReady`, so the
previous one-shot eager registration snapshotted a half-populated (often
empty) registry and the Automation kind's "Additional Schemas" came up empty.
automation-backend now registers a provider instead, so trigger/action config
docs always reflect the fully-populated registries.

Documentation-only surface; no runtime reconcile behaviour changes.
