---
"@checkmate-monitor/integration-backend": minor
"@checkmate-monitor/integration-webhook-backend": minor
"@checkmate-monitor/integration-jira-backend": patch
---

Fix `IntegrationProvider.testConnection` generic type

- **Breaking**: `testConnection` now receives `TConnection` (connection config) instead of `TConfig` (subscription config)
- **Breaking**: `RegisteredIntegrationProvider` now includes `TConnection` generic parameter
- Removed `testConnection` from webhook provider (providers without `connectionSchema` cannot have `testConnection`)
- Fixed Jira provider to use `JiraConnectionConfig` directly in `testConnection`

This aligns the interface with the actual behavior: `testConnection` tests connection credentials, not subscription configuration.
