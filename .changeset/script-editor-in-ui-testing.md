---
"@checkstack/automation-common": minor
"@checkstack/automation-backend": minor
"@checkstack/automation-frontend": minor
"@checkstack/integration-script-backend": minor
"@checkstack/backend-api": minor
"@checkstack/ui": minor
---

Add in-UI script testing for automation `run_script` / `run_shell` actions.

A new `testScript` RPC runs a TypeScript or shell script against an
editable, auto-seeded sample context using the same sandboxed runner the
real action uses, so operators can test scripts directly in the editor
without dispatching a whole automation. Surfaces beneath any script field
flagged `x-script-testable` via the new `ScriptTestPanel` /
`ContextSampleEditor` components in `@checkstack/ui` and the
`scriptTestRenderer` prop threaded through `DynamicForm`.

- `@checkstack/automation-common`: adds the `testScript` contract +
  `ScriptTest*` schemas (gated by `automation.manage`).
- `@checkstack/automation-backend`: implements `testScript` reusing the
  shared ESM / shell runners; central-only, time-bounded.
- `@checkstack/backend-api`: new `x-script-testable` config-schema
  metadata propagated to the frontend JSON Schema.
- `@checkstack/ui`: new `ScriptTestPanel` + `ContextSampleEditor`
  components and a `scriptTestRenderer` prop on `DynamicForm`.
- `@checkstack/automation-frontend`: wires the test panel into the action
  editor.
- `@checkstack/integration-script-backend`: marks the `run_script` /
  `run_shell` script fields as testable.
