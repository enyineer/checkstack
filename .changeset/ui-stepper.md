---
"@checkstack/ui": minor
---

feat(ui): add a Stepper primitive

Add a presentational `Stepper` step-indicator component and a `useStepper` state
hook for building guided multi-step flows (used by the new "create your first
check" onboarding wizard). Completed steps are navigable; the active step is
highlighted; future steps are muted. Animations are disabled on low-power
devices via `usePerformance`.
