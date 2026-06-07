---
"@checkstack/automation-backend": minor
---

feat(automation): validate AI-proposed automations at propose time

`automation.propose`'s dry run now catches the three ways an AI-authored
automation silently fails before it is applied, surfacing each as a clear,
actionable error on the review card instead of a runtime failure:

- A `runAs` that does not exist or that the caller may not bind is rejected
  with guidance to call `automation.listServiceAccounts`, using the same
  bindable-application check the create/update gate enforces at save time.
- A `connectionId` that does not reference a real connection for the action's
  provider is rejected with guidance to call `automation.listConnections`.
  Templated connection ids are skipped, and a lookup failure degrades to a soft
  "could not verify" note rather than a hard error.
- An unwired artifact/template reference (`{{ artifacts.<id>... }}` whose
  producer action id does not exist or does not produce an artifact) is flagged
  by the definition validator, which now walks configs, variables blocks,
  `choose` `when` clauses, and conditions. Built-in roots (trigger/vars/now)
  and literal prose are left untouched.
