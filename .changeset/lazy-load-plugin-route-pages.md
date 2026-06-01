---
"@checkstack/frontend": minor
"@checkstack/about-frontend": minor
"@checkstack/announcement-frontend": minor
"@checkstack/api-docs-frontend": minor
"@checkstack/automation-frontend": minor
"@checkstack/catalog-frontend": minor
"@checkstack/dependency-frontend": minor
"@checkstack/gitops-frontend": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/incident-frontend": minor
"@checkstack/infrastructure-frontend": minor
"@checkstack/integration-frontend": minor
"@checkstack/maintenance-frontend": minor
"@checkstack/notification-frontend": minor
"@checkstack/pluginmanager-frontend": minor
"@checkstack/satellite-frontend": minor
"@checkstack/script-packages-frontend": minor
"@checkstack/secrets-frontend": minor
"@checkstack/slo-frontend": minor
---

Lazy-load plugin route pages so their component bodies are fetched on navigation instead of in the initial load.

Each plugin's route `element` now references a `React.lazy`-wrapped page component (`const FooPage = lazy(() => import("./pages/FooPage").then((m) => ({ default: m.FooPage })))`) instead of a statically imported one, and `App.tsx` renders every route element inside a shared `<Suspense>` boundary (fallback mirrors `RouteGuard`'s access-loading spinner). The `FrontendPlugin` contract, plugin registry, and plugin loader are unchanged - plugins still register synchronously, so nav, slots, commands, API factories, and `foreignSignals` are all available on first paint.

This moves the 37 route-page chunks (~600 KB raw) out of the entry: the main entry chunk drops from ~2.4 MB to ~190 KB and navigating to a heavy page (e.g. the automation editor) no longer costs that code up front. Auth flow pages (login/register/forgot/reset) are intentionally kept eager so the unauthenticated landing path has no extra chunk fetch.
