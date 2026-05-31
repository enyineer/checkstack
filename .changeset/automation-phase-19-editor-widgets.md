---
"@checkstack/ui": minor
"@checkstack/automation-frontend": minor
---

Add the sensing-layer editor UX (Wave 2 Phase 19) - the visual widgets for the duration-aware and structured-condition building blocks from Phases 15-18.

- New `@checkstack/ui` components (each with a Storybook story):
  - `DurationInput` - number + unit (`seconds` / `minutes` / `hours`) picker emitting the single-unit `Duration` object the backend accepts, so it round-trips losslessly through YAML.
  - `TimeOfDayInput` - HH:MM (24h) input emitting the `"HH:mm"` string the `time` condition's `after` / `before` accept. Both are plain inputs (no animations), so no `usePerformance` gating is needed.
- `DynamicForm`'s `FormField` gains an additive `x-duration` / `format: "duration"` branch that renders `DurationInput` for schema-driven duration configs. (Additive alongside the existing dispatch; reconciles cleanly with the parallel branch's `FormField` edits.)
- The `ConditionEditor` kind selector gains `numeric_state` / `time` / `state` structured branches: an operator dropdown (above / below / between) + threshold for numeric, `TimeOfDayInput` + weekday toggles + timezone for time, and a status dropdown + optional `DurationInput` dwell for state. The raw-expression escape hatch is kept. Pure `kindOf` / `defaultForKind` helpers are split into a UI-free `condition-kind` module so they unit-test under bun (the UI barrel drags Monaco).
- The trigger card gains a `for:` dwell toggle + `DurationInput` (Phase 15's schema was already round-tripping in YAML).

Visual and YAML views stay lossless; structured conditions authored in either are editable in the other.
