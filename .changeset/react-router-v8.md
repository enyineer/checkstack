---
"@checkstack/about-frontend": minor
"@checkstack/ai-frontend": minor
"@checkstack/announcement-frontend": minor
"@checkstack/anomaly-frontend": minor
"@checkstack/api-docs-frontend": minor
"@checkstack/auth-frontend": minor
"@checkstack/automation-frontend": minor
"@checkstack/catalog-frontend": minor
"@checkstack/command-frontend": minor
"@checkstack/dashboard-frontend": minor
"@checkstack/dependency-frontend": minor
"@checkstack/frontend": minor
"@checkstack/gitops-frontend": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/incident-frontend": minor
"@checkstack/infrastructure-frontend": minor
"@checkstack/integration-frontend": minor
"@checkstack/logstream-frontend": minor
"@checkstack/maintenance-frontend": minor
"@checkstack/metricstream-frontend": minor
"@checkstack/notification-frontend": minor
"@checkstack/pluginmanager-frontend": minor
"@checkstack/queue-frontend": minor
"@checkstack/satellite-frontend": minor
"@checkstack/script-packages-frontend": minor
"@checkstack/secrets-frontend": minor
"@checkstack/slo-frontend": minor
"@checkstack/status-page-frontend": minor
"@checkstack/telemetry-frontend": minor
"@checkstack/tracestream-frontend": minor
"@checkstack/ui": minor
"@checkstack/ai-backend": patch
---

Migrate the frontend from react-router-dom v7 to react-router v8

Resolves GHSA-qwww-vcr4-c8h2 (HIGH): React Router before 8.3.0 has an RSC-mode
CSRF bypass that lets an action execute before the 400 response. Checkstack runs
a client-side SPA (`<BrowserRouter>`) and does not use RSC mode, so the platform
was not exploitable through it - but the advisory kept the dependency-graph
security gate red on every pull request, and the fix is only available in the 8.x
line, which the auto-remediation deliberately will not reach (it refuses major
bumps).

`react-router-dom` has no v8: it was folded into `react-router` in v7 and v8
ships as `react-router` only. So this is a package swap rather than a range bump:

- 31 packages now depend on `react-router@^8.3.0` instead of
  `react-router-dom@^7.16.0`, and 97 source files import from `react-router`.
- The Module Federation host share, `optimizeDeps` and `dedupe` entries move to
  `react-router` (shared singleton `requiredVersion` `^8.0.0`). Remotes never
  shared the router, so the remote contract is unchanged.
- The syncpack unified-range group tracks `react-router`, keeping the enforced
  single-range guarantee that a past four-range regression motivated.

The API surface Checkstack uses is unchanged between v7 and v8 - `BrowserRouter`,
`MemoryRouter`, `Routes`, `Route`, `Link`, `NavLink`, `useLocation`,
`useNavigate`, `useParams` and `useSearchParams` are all exported by v8 with the
same signatures - so no routing code changed beyond the import specifier. v8
requires React >= 19.2.7, which the workspace already pins.
