---
title: "Test scripts in the editor"
description: "Run an automation or health-check script against an editable sample context right in the editor, and replay a real automation run, before you save."
---

Any script field in Checkstack - an automation `run_script` / `run_shell` action, or an inline-script / shell health-check collector - has a built-in test panel beneath the editor. It runs your script on the central server against an editable sample context and shows the return value, stdout, stderr, exit code, and duration, so you can iterate without saving and triggering the real thing.

This walkthrough tests an automation action; health-check collectors work the same way.

## Run a script against a sample context

1. Open an automation and add (or edit) a **Run Script (TypeScript)** or **Run Shell Script** action.
2. Write your script in the editor. Below it, the **Test script** panel shows an editable **Sample context** auto-seeded from the action's context shape.
3. Edit the sample JSON if you want different inputs, then click **Run**.
4. The result expands below: success or failure, return value, stdout / stderr, exit code (for shell), and how long it took.

For example, with this script and the seeded sample:

```ts
export default async function (context) {
  return { incident: context.trigger.payload.id, severity: context.trigger.payload.severity };
}
```

clicking **Run** returns the object built from your sample `trigger.payload`.

> [!NOTE]
> Tests run on the central server with the same sandbox and curated environment as the real action, so scripts cannot read server secrets. A real run on a satellite may differ slightly; the panel notes this.

## Map secrets to environment variables

A **Run Script** / **Run Shell Script** action can expose secrets to the script as environment variables through its **secret → env mapping**. Each row maps an environment-variable name to a secret. The secret field is a **searchable dropdown**: start typing to filter the secret names from your backend, then pick one with the mouse or arrow keys plus Enter. You can also free-type a name that does not exist yet (a secret you plan to create later) - it still saves. Checkstack stores each entry as a `${{ secrets.NAME }}` template behind the scenes, so you only ever deal with the bare name in the editor. You can also author the mapping by name in YAML (`secretEnv: { API_TOKEN: jira_token }`).

> [!NOTE]
> If a row references a secret name that your backend does not currently have, the row shows a non-blocking warning ("No secret named X - it may have been deleted or renamed"). This is a hint, not a block: the secret might be created later, or the list might be momentarily stale, so the action still saves.

Once a mapping is declared, the environment-variable names autocomplete in the **Run Script (TypeScript)** editor under `process.env.` and are typed as `string`, so reading them is type-checked:

```ts
export default async function () {
  // `API_TOKEN` (declared in the secret -> env mapping) autocompletes here.
  return { hasToken: process.env.API_TOKEN.length > 0 };
}
```

When you test a script that has a mapping, the test panel **never** resolves your real secret values. Instead:

1. By default, each mapped env var is injected as a named placeholder - `process.env.API_TOKEN === "__SECRET_jira_token__"` - so your script's code paths that read the variable still run.
2. For a more realistic run, fill in a **Secret test override** for any referenced secret. The panel shows one optional input per distinct secret name. Whatever you type is a test value only: it is masked out of the captured output and is never sent as, or compared against, your real secret.

```ts
export default async function () {
  // Defined in the test even with no override (placeholder value).
  return { hasToken: Boolean(process.env.API_TOKEN) };
}
```

## Load context from a real run

For automation scripts you can seed the sample from an actual run instead of editing JSON by hand:

1. In the **Sample context** header, open the **Load from run** dropdown.
2. Pick a recent run. Its trigger payload and artifacts populate the sample context.
3. Click **Run** to replay your script against that run's data.

If a run has already finished and its working state was cleared, the trigger and artifacts are still reconstructed; only loop and variable state may be missing, and the panel says so. Health-check collectors do not support replay - their executions do not retain enough context - so use the auto-seeded sample there.

## Test scripts that import npm packages

If your script imports an [allowlisted npm package](/checkstack/user-guide/guides/manage-script-packages/), the test resolves it the same way the real run does, so testing matches runtime. If the package set has not finished syncing on the server, the test reports a clear "npm packages not ready" error rather than running against a stale set.
