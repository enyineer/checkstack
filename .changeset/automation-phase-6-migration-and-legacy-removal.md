---
"@checkstack/integration-backend": minor
"@checkstack/integration-common": minor
"@checkstack/integration-frontend": minor
"@checkstack/integration-jira-backend": minor
"@checkstack/integration-teams-backend": minor
"@checkstack/integration-webex-backend": minor
"@checkstack/integration-webhook-backend": minor
"@checkstack/integration-script-backend": minor
"@checkstack/automation-backend": minor
"@checkstack/automation-common": minor
"@checkstack/healthcheck-backend": patch
"@checkstack/maintenance-backend": patch
"@checkstack/slo-backend": patch
---

feat(automation): one-time migration of webhook subscriptions + remove legacy integration backend

**BREAKING CHANGES** (platform is in BETA — no major bump):

- `IntegrationProvider` no longer carries `config` (subscription
  config) or `deliver`. The interface now models a connection provider
  only: connection schema + `getConnectionOptions` + `testConnection`.
- The legacy subscription / delivery-log / event endpoints
  (`listSubscriptions`, `createSubscription`, `getDeliveryLogs`,
  `listEventTypes`, …) are removed from `integrationContract`.
- `delivery-coordinator`, `hook-subscriber`, `event-registry`, and the
  `integrationEventExtensionPoint` are deleted. Plugins that
  previously called `integrationEvents.registerEvent(...)` now
  register their hooks as automation triggers via
  `automationTriggerExtensionPoint.registerTrigger(...)`.
- Frontend pages `IntegrationsPage` and `DeliveryLogsPage` are gone;
  the integration plugin's only remaining UI is connection
  management. Subscription management lives under `/automation/...`.
- `webhook_subscriptions` and `delivery_logs` tables stay in the
  database for one release as a safety net (no code reads or writes
  them), and will be dropped in a follow-up migration.

**New**:

- `jira.create_issue`, `teams.post_message`, `webex.post_message`,
  `webhook.send`, `integration-script.run_shell`, and
  `integration-script.run_script` actions registered against the
  Automation Platform with matching `*.message`, `*.delivery`,
  `shell.result`, and `script.result` artifact types. The script
  plugin exposes **two** actions — `run_shell` runs bash via the
  shared `ShellScriptRunner` (Monaco `shell` editor), `run_script`
  runs an ESM module in a Bun subprocess via `EsmScriptRunner`
  (Monaco `typescript` editor + `defineIntegration` helper) — to
  preserve the legacy provider split. `jira.create_issue` keeps the
  dynamic field-mapping dropdown (driven by
  `JIRA_RESOLVERS.FIELD_OPTIONS`).
- One-time data migration runs on boot in
  `automation-backend.afterPluginsReady`. It reads
  `webhook_subscriptions` via a new service RPC
  `IntegrationApi.listLegacySubscriptions`, translates each row into
  a single-trigger / single-action automation (marked with
  `managed_by = "migrated-subscription:<id>"`), and is idempotent
  across restarts.
- Failed translations are recorded in a new
  `automation_migration_failures` table and surfaced via
  `AutomationApi.listMigrationFailures` /
  `acknowledgeMigrationFailure` so admins can review and re-create
  failed entries by hand.
