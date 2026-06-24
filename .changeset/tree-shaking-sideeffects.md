---
"@checkstack/about-common": patch
"@checkstack/about-frontend": patch
"@checkstack/ai-common": patch
"@checkstack/ai-frontend": patch
"@checkstack/announcement-common": patch
"@checkstack/anomaly-common": patch
"@checkstack/anomaly-frontend": patch
"@checkstack/api-docs-common": patch
"@checkstack/api-docs-frontend": patch
"@checkstack/auth-common": patch
"@checkstack/automation-common": patch
"@checkstack/automation-frontend": patch
"@checkstack/cache-common": patch
"@checkstack/cache-frontend": patch
"@checkstack/catalog-common": patch
"@checkstack/catalog-frontend": patch
"@checkstack/command-common": patch
"@checkstack/dashboard-frontend": patch
"@checkstack/dependency-common": patch
"@checkstack/dependency-frontend": patch
"@checkstack/gitops-common": patch
"@checkstack/gitops-frontend": patch
"@checkstack/healthcheck-common": patch
"@checkstack/healthcheck-frontend": patch
"@checkstack/incident-common": patch
"@checkstack/incident-frontend": patch
"@checkstack/infrastructure-common": patch
"@checkstack/infrastructure-frontend": patch
"@checkstack/integration-common": patch
"@checkstack/integration-frontend": patch
"@checkstack/maintenance-common": patch
"@checkstack/maintenance-frontend": patch
"@checkstack/notification-common": patch
"@checkstack/notification-frontend": patch
"@checkstack/pluginmanager-common": patch
"@checkstack/pluginmanager-frontend": patch
"@checkstack/queue-common": patch
"@checkstack/queue-frontend": patch
"@checkstack/satellite-common": patch
"@checkstack/satellite-frontend": patch
"@checkstack/script-packages-common": patch
"@checkstack/script-packages-frontend": patch
"@checkstack/secrets-common": patch
"@checkstack/secrets-frontend": patch
"@checkstack/signal-common": patch
"@checkstack/slo-common": patch
"@checkstack/slo-frontend": patch
"@checkstack/test-utils-frontend": patch
"@checkstack/theme-common": patch
"@checkstack/theme-frontend": patch
"@checkstack/tips-common": patch
"@checkstack/tips-frontend": patch
"@checkstack/cache-memory-common": patch
"@checkstack/healthcheck-rcon-common": patch
"@checkstack/healthcheck-ssh-common": patch
"@checkstack/integration-jira-common": patch
"@checkstack/queue-bullmq-common": patch
"@checkstack/queue-memory-common": patch
---

Declare `sideEffects` (CSS-only) so bundlers can tree-shake these packages' barrel exports

These packages now declare `"sideEffects": ["**/*.css"]` in their
`package.json`. This lets a consuming bundle drop unused barrel re-exports
instead of pulling a whole package's component graph when only one
provider/hook is imported (e.g. importing `SessionProvider` no longer dragged an
admin form). It is build metadata only - no runtime behavior change.
