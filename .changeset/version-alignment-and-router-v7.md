---
"@checkstack/about-frontend": minor
"@checkstack/announcement-backend": minor
"@checkstack/announcement-common": minor
"@checkstack/announcement-frontend": minor
"@checkstack/anomaly-backend": minor
"@checkstack/anomaly-frontend": minor
"@checkstack/api-docs-frontend": minor
"@checkstack/auth-backend": minor
"@checkstack/auth-common": minor
"@checkstack/auth-frontend": minor
"@checkstack/auth-ldap-backend": minor
"@checkstack/auth-saml-backend": minor
"@checkstack/automation-backend": minor
"@checkstack/automation-common": minor
"@checkstack/automation-frontend": minor
"@checkstack/backend": minor
"@checkstack/backend-api": minor
"@checkstack/cache-backend": minor
"@checkstack/cache-common": minor
"@checkstack/catalog-backend": minor
"@checkstack/catalog-common": minor
"@checkstack/catalog-frontend": minor
"@checkstack/command-backend": minor
"@checkstack/command-common": minor
"@checkstack/command-frontend": minor
"@checkstack/common": minor
"@checkstack/dashboard-frontend": minor
"@checkstack/dependency-backend": minor
"@checkstack/dependency-common": minor
"@checkstack/dependency-frontend": minor
"@checkstack/dev-server": minor
"@checkstack/frontend": minor
"@checkstack/frontend-api": minor
"@checkstack/gitops-backend": minor
"@checkstack/gitops-common": minor
"@checkstack/gitops-frontend": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/incident-backend": minor
"@checkstack/incident-common": minor
"@checkstack/incident-frontend": minor
"@checkstack/infrastructure-frontend": minor
"@checkstack/integration-backend": minor
"@checkstack/integration-common": minor
"@checkstack/integration-frontend": minor
"@checkstack/integration-jira-backend": minor
"@checkstack/maintenance-backend": minor
"@checkstack/maintenance-common": minor
"@checkstack/maintenance-frontend": minor
"@checkstack/notification-backend": minor
"@checkstack/notification-common": minor
"@checkstack/notification-frontend": minor
"@checkstack/pluginmanager-frontend": minor
"@checkstack/queue-backend": minor
"@checkstack/queue-common": minor
"@checkstack/queue-frontend": minor
"@checkstack/satellite-backend": minor
"@checkstack/satellite-common": minor
"@checkstack/satellite-frontend": minor
"@checkstack/script-packages-backend": minor
"@checkstack/script-packages-common": minor
"@checkstack/script-packages-frontend": minor
"@checkstack/scripts": minor
"@checkstack/secrets-backend": minor
"@checkstack/secrets-common": minor
"@checkstack/secrets-frontend": minor
"@checkstack/signal-frontend": minor
"@checkstack/slo-backend": minor
"@checkstack/slo-common": minor
"@checkstack/slo-frontend": minor
"@checkstack/test-utils-frontend": minor
"@checkstack/theme-backend": minor
"@checkstack/theme-common": minor
"@checkstack/theme-frontend": minor
"@checkstack/tips-backend": minor
"@checkstack/tips-common": minor
"@checkstack/tips-frontend": minor
"@checkstack/ui": minor
---

Align workspace dependency versions and migrate React Router to v7.

BREAKING CHANGES (React Router v7): All frontend packages now depend on `react-router-dom@^7.16.0`. Previously the workspace declared four divergent ranges (`^6.20.0`, `^6.22.0`, `^7.1.1`, `^7.14.2`), which resolved both `react-router@6` and `react-router@7` into a single bundle. Everything is now unified on v7. The public imports the app uses (`BrowserRouter`, `Routes`, `Route`, `Link`, `NavLink`, `MemoryRouter`, `useNavigate`, `useParams`, `useSearchParams`, `useLocation`) are unchanged between v6 and v7, so no source rewrites were required - but any out-of-tree plugin still on react-router v6 should upgrade to v7 (see the React Router v6 -> v7 upgrade guide) to share the host's single router instance via the import map.

Other unified ranges (no API change): `react` -> `^18.3.1`, the `@orpc/*` family (`contract`, `server`, `client`, `tanstack-query`, `openapi`, `zod`) -> `^1.14.4`, and `better-auth` -> `^1.6.13`.

Removed the pre-rename `@orpc/react-query` leftover from `@checkstack/frontend-api`; its `createRouterUtils` / `RouterUtils` / `ProcedureUtils` now come from `@orpc/tanstack-query` (the package already in use).

Stale in-range runtime deps pulled up to current published versions: `hono` `^4.12.23`, `@tanstack/react-query` (+devtools) `^5.100.14`, `date-fns` `^4.4.0`, `jose` `^6.2.3`, `tar` `^7.5.16`, `semver` `^7.8.1`, `@xyflow/react` `^12.11.0`.
