---
"@checkstack/automation-frontend": minor
---

Fix `context.*` IntelliSense disappearing in the automation inline-script editor.

The action editor concatenates the scope-derived `declare const context`
global with the `secretEnv` `process.env` augmentation into a single Monaco
extra-lib. `generateSecretEnvTypes` emitted module-form output
(`declare global { … } export {};`), and the top-level `export {};` turned the
whole concatenated `.d.ts` into a module - which silently demoted
`declare const context` from a global ambient to a module-local binding, so
`context.trigger.payload` (and everything under `context`) stopped
autocompleting. Because the empty case also emitted `export {};`, every
automation script action was affected regardless of declared secrets. Health
check script editors were unaffected (they never merge the secretEnv lib).

`generateSecretEnvTypes` now emits a global-script-compatible ambient
augmentation (`declare namespace NodeJS { interface ProcessEnv { … } }`) and an
empty string when there is nothing to declare, so the merged extra-lib stays a
global script and `context` remains globally visible. A regression test guards
that the merged `context + secretEnv` output contains no top-level
`export`/`import`.
