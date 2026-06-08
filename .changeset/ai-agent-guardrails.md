---
"@checkstack/ai-backend": minor
"@checkstack/automation-backend": minor
---

feat(ai): close the agent feedback loop and harden boundary awareness

Tighten the agentic workflows so the model understands its context, grounds
itself in the docs, asks instead of guessing, and never surfaces unvalidated
output to the user.

- **Propose validation feedback loop.** A proposable tool's `dryRun` now throws
  the shared `ToolValidationError` (exported from `@checkstack/ai-backend`) when
  the model's drafted input is semantically invalid (fabricated `runAs`, unknown
  `connectionId`, unwired/wrong-typed artifact reference). Chat catches it and
  returns the structured `issues` to the MODEL as the tool result so it
  self-corrects and re-proposes, instead of throwing a raw "the assistant hit an
  error" at the operator and losing the proposal. Holds in both modes: in `auto`
  mode a draft that fails validation is fed back, never auto-applied, so a broken
  automation is never created. The failed attempt is not counted by the per-turn
  duplicate guard, so the corrected retry is allowed.
- **Headless AI action hardening.** The unattended agent runner now injects a
  shared baseline prompt stating its boundaries (bounded service account;
  changes apply immediately and irreversibly; an empty result may be a
  permission boundary, not "nothing exists"; ground concepts in the docs; never
  fabricate). An author-supplied `systemPrompt` now APPENDS to this baseline
  instead of replacing it, so an override can never silently drop a safety line.
  The structured-output pass gained a bounded repair loop: on a schema miss it
  feeds the validation error back and retries before failing, so a recoverable
  near-miss self-corrects while a malformed object still never reaches a
  downstream `choose`/`condition`.
- **Chat prompt clarity.** The chat system prompt now names the `searchDocs` /
  `getDoc` tools and tells the model to ground concept/how-to answers in the
  docs, to ASK the operator a clarifying question rather than invent a missing
  value, that an empty/short result may be its own access scope (never assert a
  definitive all-clear), and which permission mode the conversation is in.
- **Schema polish.** `system.issues` `systemIds` and `automation.propose`
  `runAs` now carry field-level `.describe()` guidance steering the model to real
  ids from `catalog_listSystems` / `automation.listServiceAccounts` (never a name
  or an invented value). The propose-time connection check now emits a soft
  "could not verify" issue when the action catalog cannot be loaded, instead of
  silently skipping the check and letting a fabricated `connectionId` through.
