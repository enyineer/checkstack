---
"@checkstack/script-packages-backend": minor
"@checkstack/script-packages-common": minor
"@checkstack/script-packages-frontend": minor
---

Add scheduled vulnerability auditing for Script Packages.

A daily recurring job runs `bun audit --json` against the installed script-packages tree, persists advisories to new plugin-owned Postgres tables (`script_package_audit_advisory` keyed by lockfile hash + advisory id, plus a `script_package_audit_state` singleton last-run summary), and notifies every holder of `script-packages.manage` when a new or severity-escalated advisory appears. All severities are recorded; notifications fire on medium/high/critical, with a stable per-advisory key + a durable `notified` flag suppressing repeat-notify on an unchanged set. The pass is single-flight across the cluster via the existing installer advisory lock (mutually exclusive with installs, storage migrations, and blob GC) and reuses the installer's scratch / `.npmrc` / registry setup, reporting purely from the lockfile. New `getAuditState` and `auditNow` RPCs (gated by `script-packages.manage`), a `SCRIPT_PACKAGES_AUDIT_COMPLETED` signal, and a "Vulnerability audit" section in the settings page with an "Audit now" button that live-refreshes on completion.

State and scale: audit results are the cluster-wide source of truth in Postgres (not the pod-local node_modules tree), so any pod returns the same advisories regardless of which pod ran the audit.

This is a beta minor.
