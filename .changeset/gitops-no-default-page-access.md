---
"@checkstack/gitops-common": minor
---

Stop granting the GitOps page to regular users by default. `provider.read` and
`secret.read` are no longer default rules, so new users don't see the GitOps
page/nav; grant `provider.read` explicitly to roles that should. The
provenance-lock primitives every editor relies on (`getProvenance` /
`listProvenance`) move to a NEW default `gitops.provenance.read` rule, so lock
indicators in the catalog/dependency/health-check editors keep working for
everyone.

BREAKING CHANGE: on EXISTING installations the default-rule sync is add-only -
`gitops.provenance.read` is added to the Users role automatically on next
boot, but previously-synced `gitops.provider.read` / `gitops.secret.read`
grants stay on the role until an admin removes them under Auth Settings ->
Roles.
