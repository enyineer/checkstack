---
"@checkstack/automation-backend": minor
---

Fix cross-pod secret leak when a suspended automation run resumes on a different instance (security).

The run-wide output-masking registry is in-memory and per-process: it only holds the secret values a run resolved on the pod that originally ran it. When a run suspended (`wait_for_trigger` / `delay` / `wait_until`) on pod A and later resumed — via the wake path (`resumeRun`) or the stalled-run sweeper (`recoverStalledRun`) — on pod B with a fresh, empty registry, every masking choke point on pod B (step output, run error, scope snapshot, artifact data) ran against an EMPTY mask set. Any value still carrying pod A's resolved credential (a carried-over scope variable, an artifact echoing it, a provider error string) was therefore persisted UNMASKED, where `getRunScopeForReplay` and the run-detail UI could read it. This was the deferred "L2 cross-pod masking" gap.

Fix: on `resumeRun` / `recoverStalledRun`, RE-SEED the resuming pod's mask registry BEFORE walking or persisting. The engine re-resolves the automation's declared secret refs — the `secretEnv` mappings and `connectionId` references its action configs use, collected by walking the full nested action tree — through the run's already-wrapped `getService`, which auto-registers each resolved value. This re-populates exactly the least-privilege, by-value mask set the run is allowed to see (re-resolving is the same set the run resolves during normal execution, so it grants no extra access). Re-seeding is best-effort: a rotated/deleted secret simply isn't added to the mask set (the action's own re-run would surface a genuinely-missing secret), and a resolution failure never aborts the resume. No-op when masking isn't wired (tests / minimal installs).
