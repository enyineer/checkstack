---
"@checkstack/frontend-api": minor
"@checkstack/frontend": minor
"@checkstack/auth-frontend": minor
"@checkstack/common": minor
"@checkstack/backend": minor
"@checkstack/ai-frontend": patch
"@checkstack/announcement-frontend": patch
"@checkstack/api-docs-frontend": patch
"@checkstack/automation-frontend": patch
"@checkstack/catalog-frontend": patch
"@checkstack/dependency-frontend": patch
"@checkstack/gitops-frontend": patch
"@checkstack/healthcheck-frontend": patch
"@checkstack/incident-frontend": patch
"@checkstack/infrastructure-frontend": patch
"@checkstack/integration-frontend": patch
"@checkstack/maintenance-frontend": patch
"@checkstack/notification-frontend": patch
"@checkstack/pluginmanager-frontend": patch
"@checkstack/satellite-frontend": patch
"@checkstack/script-packages-frontend": patch
"@checkstack/secrets-frontend": patch
"@checkstack/slo-frontend": patch
---

Move primary navigation into a left sidebar, and serve the user guide in-app.

Feature navigation (a ~20-item user-menu dropdown) now lives in a persistent left sidebar (a slide-over drawer on mobile), grouped by section with the active route highlighted; the user menu keeps only account actions. A route opts into the sidebar with new `nav` metadata (`{ group, icon, label?, order?, accessRule? }`) on its registration, co-located with path + access + title. The sidebar filters entries with the same access check as page guards. `@checkstack/common` gains `isAccessRuleSatisfied` and a centralized set of in-app doc slugs (`APP_DOC_SLUGS` + `docsPath`, with a test asserting each resolves to a real docs page); `@checkstack/auth-frontend` exports `useAccessRules`.

The backend now serves the Astro Starlight docs build same-origin at `/checkstack/*` (the same artifact deployed to GitHub Pages), so the user guide is available inside the app including for self-hosted / air-gapped installs (served verbatim, no rebuild, no link rewriting; from `CHECKSTACK_DOCS_DIST`, before the SPA catch-all, degrading gracefully when absent; the Docker image builds and ships `docs/dist`; Vite proxies `/checkstack` in dev). The "Docs" link is a shell-owned external sidebar entry under the Documentation group (book icon), opening `/checkstack/user-guide/` in a new tab; the group renders even when no plugin route contributes to it.

BREAKING (plugin authors): `UserMenuItemsSlot` is no longer the way to add navigation - registering a top user-menu item no longer surfaces it anywhere. Add `nav` to the page's route instead. `UserMenuItemsBottomSlot` (account items) is unchanged. All bundled plugins have been migrated.

This is a beta minor.
