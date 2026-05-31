---
"@checkstack/automation-backend": minor
---

Fix the `Automation` kind showing an empty "Additional Schemas" section in the GitOps Entity Kind Registry. The spec-schema documentation for `triggers[].config` and `actions[].config` was registered with `conditions` pointing at the `triggers[].event` / `actions[].action` discriminators. Those discriminators have no variant-selector group of their own in the kind browser, so the conditions could never be satisfied and every entry was filtered out (the section rendered empty even though the docs were registered).

The trigger/action config docs are now emitted as standalone variants (no `conditions`), mirroring how Healthcheck surfaces its primary `config` (strategy) field. Each field now renders its own variant dropdown so operators can browse every trigger and provider-action config schema directly.
