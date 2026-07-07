---
"@checkstack/frontend-api": minor
"@checkstack/auth-frontend": minor
"@checkstack/automation-frontend": minor
"@checkstack/backend-api": minor
---

Fuse authorization into the RPC call so a frontend gate can't drift from - or be
forgotten alongside - the procedure it guards. This is the structural endpoint of
the contract-derived gating work: instead of pairing `client.X.useMutation()` with
a separate `useProcedureAccess(X)`, the gate is welded to the call.

- `useGatedMutation` / `useGatedQuery` (`@checkstack/frontend-api`): the plugin
  client's mutation/query hooks now have gate-fused variants that derive the
  authorization verdict from the SAME contract procedure and input the call uses
  and return it as `{ allowed, accessLoading }` on the result. A control cannot
  obtain `mutate` without the verdict, and a gated query stays disabled until the
  caller is authorized (no guaranteed-403 fetch). The id a mutation gates on is
  passed as `gateInput` (e.g. `{ id }`), the same id `mutate` will send.
- `accessApi.useSurfaceAccess(procedure)` (`@checkstack/auth-frontend`): the
  coarse "can the user reach this management surface" gate, DERIVED from a
  representative procedure of the page (its access rule + object/parent type from
  the contract) instead of hand-passed `objectType`/`parentType` that can drift.
  Generalizes the hand-authored `useCanAccessType` surface gate.
- Runtime gating-drift detector (`@checkstack/backend-api`): the auth middleware
  logs, in dev/e2e only (no-op in production), when a real user is denied a
  global-only gate - a candidate for the "shown-but-denied" drift class. A
  belt-and-suspenders net for hand-rolled/dynamic call paths the fused hooks
  don't cover.

The automation editor is the reference surface: its create/update gates are fused
directly into the create/update mutations, so there is no separate gate hook to
keep in sync, and its surface gate uses `useSurfaceAccess`. The run-detail page's
"Cancel run" control is also fused onto
`cancelRun` - a real drift fix: it previously gated on a bare
`useAccess(automation.manage)` (the GLOBAL rule), so a team-scoped manager with a
grant on the automation but no global rule saw no Cancel button even though the
`parentScope`d backend would authorize them; the fused gate derives the verdict
from the page's `automationId`, so they now see it. A
`checkstack/prefer-gated-mutation` lint rule (dev tooling, scoped, `warn`) nudges
raw `.useMutation()` toward the fused variant so fusion is the default and raw
mutations become the deliberate, greppable exception (the remaining raw automation
mutations - per-row toggle/delete gated via `useResourceAccess`, and the
stateless `renderTemplate` utility - carry a documented suppression).

No behavior change for existing call sites: `useMutation` / `useQuery` /
`useCanAccessType` are unchanged and remain for per-row arrays, non-procedure
gates, and compound controls.
