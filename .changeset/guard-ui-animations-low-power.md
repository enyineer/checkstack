---
"@checkstack/ui": minor
---

Guard shared component animations behind `usePerformance().isLowPower`.

`Tabs` (panel enter), `ConfirmationModal` (open enter), `Accordion` (expand/collapse height) and `CodeEditor` (popout-button backdrop blur) previously applied their `animate-*` / `backdrop-blur` classes unconditionally. They now drop those classes when the device reports the low-power tier, matching the existing `LoadingSpinner` / `Skeleton` behaviour and the `.agent/rules/performance.md` degradation rule. No public API change; on normal-power devices the rendered output is unchanged.
