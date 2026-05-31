---
"@checkstack/secrets-common": minor
"@checkstack/ui": minor
"@checkstack/automation-frontend": minor
"@checkstack/healthcheck-frontend": minor
---

Fix the automation Run Script action's `secretEnv` (secret → env mapping) test wiring and tolerate bare secret names.

- `@checkstack/ui` `ScriptTestPanel` now accepts the script field's declared `secretEnv` and renders an optional per-secret test-override input. The `ScriptTestRenderer` callback (DynamicForm) receives the SIBLING `x-secret-env` mapping value, located by annotation (not by field name), so a testable script field forwards it to the panel. Previously the test path never sent `secretEnv`, so `buildTestSecretEnv` got `undefined` and `process.env.<env>` was undefined in an in-UI test. Now an override-less test injects `__SECRET_<NAME>__` placeholders, and any operator override is masked from the output. Real secret values are still NEVER resolved in the test path.
- `@checkstack/automation-frontend` forwards the action's `secretEnv` and the collected overrides to `testScript`.
- `@checkstack/secrets-common`: the `secretEnv` mapping VALUE now accepts EITHER a `${{ secrets.NAME }}` template OR a bare secret name, normalizing a bare name to the canonical `${{ secrets.NAME }}` template on parse. This is a forgiving / NARROWING input change (more inputs accepted; stored/output form is unchanged and still the template), not a breaking change. Existing data and YAML shorthand like `secretEnv: { secret: SECRET }` now pass config validation instead of failing with "Must contain a ${{ secrets.NAME }} reference". Partial inline interpolation (e.g. `u:${{ secrets.pw }}@host`) keeps working unchanged; values that are neither a secret reference nor a valid secret name are still rejected.
- `@checkstack/ui` `parseSecretName` tolerates a legacy bare secret name for display so the picker shows the same name for both the template and the bare form.

The healthcheck collector test panel was checked: its config has no `x-secret-env` field, so it needed no secret wiring (only the `onRun` signature change, which is backward compatible).
