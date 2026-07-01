---
"@checkstack/notification-frontend": minor
---

Fix a Safari-only crash that 404'd the catalog plugin (and any page relying on
notification subject-kind rendering). The `SubjectKindRegistry` and
`SubscriptionSubControlsRegistry` module-level `Map`s are now lazily
initialised behind an accessor, so a registrant that calls
`registerSubjectKind` / `registerSubscriptionSubControls` as a top-level import
side effect can never observe an undefined registry.

Previously the registry was a module-level `const registry = new Map()`.
`catalog-frontend` registers its subject kinds at import time, and under
Safari's production Module Federation chunk-evaluation order the exported
`registerSubjectKind` function ran before that field initialiser, throwing
`undefined is not an object (evaluating 'registry.set')` — which surfaced as
"Failed to load local plugin from .../catalog-frontend/src/index.tsx" and a 404
on `/catalog`. Chrome/Firefox happened to evaluate the modules in an order that
masked the bug. The lazy accessor removes the evaluation-order dependency
entirely, so registration works regardless of bundler/browser ordering.
