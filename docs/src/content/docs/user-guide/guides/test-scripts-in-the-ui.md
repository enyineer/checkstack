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

## Load context from a real run

For automation scripts you can seed the sample from an actual run instead of editing JSON by hand:

1. In the **Sample context** header, open the **Load from run** dropdown.
2. Pick a recent run. Its trigger payload and artifacts populate the sample context.
3. Click **Run** to replay your script against that run's data.

If a run has already finished and its working state was cleared, the trigger and artifacts are still reconstructed; only loop and variable state may be missing, and the panel says so. Health-check collectors do not support replay - their executions do not retain enough context - so use the auto-seeded sample there.

## Test scripts that import npm packages

If your script imports an [allowlisted npm package](/checkstack/user-guide/guides/manage-script-packages/), the test resolves it the same way the real run does, so testing matches runtime. If the package set has not finished syncing on the server, the test reports a clear "npm packages not ready" error rather than running against a stale set.
