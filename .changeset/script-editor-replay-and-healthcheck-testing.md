---
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/healthcheck-script-backend": minor
"@checkstack/automation-common": minor
"@checkstack/automation-backend": minor
"@checkstack/automation-frontend": minor
---

Extend in-UI script testing to health-check collectors, and add
load-from-run replay for automation script tests.

- Health-check collectors: a new `testCollectorScript` RPC runs the
  inline-script (TypeScript) collector and the shell `script` collector
  against an editable, auto-seeded sample context using the same
  sandboxed runner the real collector uses. Surfaces beneath the
  collector script fields in the collector editor (both marked
  `x-script-testable`). Gated by `healthcheck.configuration.manage`.
- Automation replay: a new `getRunScopeForReplay` RPC reconstructs an
  editable test context from a real run (trigger + persisted artifacts,
  plus the durable scope snapshot when the run is still in-flight), and
  the script-test panel gains a "Load from run" picker that seeds the
  sample context from a past run.

Note: health-check executions do not persist the script / config /
check / system that produced a result, so there is no health-check
replay - auto-seed is the only context source for collector tests. This
is by design; see the feature plan.
