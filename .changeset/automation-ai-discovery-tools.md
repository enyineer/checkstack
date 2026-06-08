---
"@checkstack/automation-backend": minor
---

feat(automation): add AI discovery tools for runAs and integration connections

The automation AI assistant could fabricate values it should source from the
platform - inventing a `runAs` (e.g. "system") that does not exist, or
hand-rolling a URL/token instead of referencing a configured integration
connection - so the proposed automations failed to save or run.

Two new read-effect AI tools let the model discover real values before
proposing:

- `automation.listServiceAccounts` lists the service accounts (applications)
  the calling user may bind as an automation's `runAs`, filtered by the same
  `isApplicationBindable` subset check the create/update handler enforces at
  save time. The model picks one of these ids for `automation.propose` instead
  of inventing one.
- `automation.listConnections` lists the configured integration connections
  (grouped by provider, optionally filtered by `providerId`) so the model
  references a real `connectionId` in an integration action's config instead of
  hand-rolling credentials.

Both are gated by the automation read rule and fan out through the user-scoped
client, so handler-side authorization applies.

`automation.listConnections` discovers connection-capable providers from the
action catalog (`automation.listActions`, gated by the same `automation.read`
rule) via each action's `connectionProviderId`, NOT from the integration
plugin's admin-only `listProviders`. A caller who can read automations but lacks
`integration.manage` can therefore use the tool without hitting FORBIDDEN, and
every read degrades gracefully: a failed catalog fetch yields an empty result
and a failed per-provider connection listing yields an empty connection list,
so the model always gets a usable partial result instead of a hard tool error.
