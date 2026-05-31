---
"@checkstack/automation-frontend": minor
"@checkstack/integration-script-backend": minor
"@checkstack/script-packages-frontend": patch
"@checkstack/ui": minor
---

Improve the automation Run Script secret → env mapping editor and script IntelliSense.

- **Searchable secret picker with existence validation.** The secret → env mapping editor (`SecretEnvEditor`) now uses a searchable, keyboard-navigable combobox (modeled on `VariablePicker` / `PackageNameCombobox`, `isLowPower`-aware) populated from the secrets plugin's `listSecretNames`, replacing the plain `<input>` + `<datalist>`. A free-typed name still round-trips (a secret may be created later). When a row references a name that the loaded list does not contain, the row shows a non-blocking warning (red border + message); save is not prevented. The existence check lives in a pure, unit-tested `unknownSecretNames` helper.
- **Clearer field description.** The `secretEnv` field descriptions on the `run_script` / `run_shell` actions no longer show the stored `${{ secrets.NAME }}` template (which is confusing in a UI that takes a bare name); they now describe the actual UI behavior and how the value is injected (`process.env.<ENV_NAME>` / `$<ENV_NAME>`) and masked.
- **`process.env.<ENV_NAME>` autocomplete.** Declared `secretEnv` env-var names now autocomplete under `process.env.` in the Run Script (TypeScript) Monaco editor and are typed `string`, via an ambient `NodeJS.ProcessEnv` augmentation merged into the editor type definitions. New pure, unit-tested generators `generateSecretEnvTypes` and `secretEnvEnvNames` (exported from `@checkstack/automation-frontend`) drive this; the augmentation coexists with `@types/node`'s existing index signature.
- **Shared combobox-interaction helper.** The "opens-then-immediately-closes" popover guard (`comboboxAnchorProps` / `isAnchorInteraction`) is promoted from `@checkstack/script-packages-frontend` into `@checkstack/ui` so the new secret picker and the existing package/version comboboxes share one implementation; the package comboboxes now import it from `@checkstack/ui` and the local copy is removed.
